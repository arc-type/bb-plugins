// Integration via the base branch (§3.9.1).
//
// A crew delivers by asking to merge its crew branch into `main`. The merge
// itself sits behind `GitBackend`, so a hosted merge request (GitLab, GitHub)
// can replace the local implementation later without touching the rules:
//
// - Default: the human merges. An open request puts the lead on "Needs you"
//   with reason `merge-request` (derived in activity from `merge_requests`).
// - With a member marked `integrator: true` anywhere in the
//   project, that member merges — but only when the crew file's `checks`
//   command exits 0 in the crew branch's worktree. Red checks, no checks
//   command, or a conflict return the request to the human (`returned`).
// - After a merge every running crew's lead gets a non-waking system note
//   "main moved"; dependencies waiting for `merged` are checked at once.
// - Rebase conflicts put the member that owns the branch on "Needs you"
//   with reason `merge-conflict`.
//
// Local case (the sandbox has no remote): "merge request" is a row in the
// plugin DB, "merge" is a commit built by `git merge-tree` + `commit-tree`,
// fast-forwarded into the worktree that has the base branch checked out (or
// moved by `update-ref` when none has), and
// the crew branch is the branch BB gave the lead's worktree.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { AddressError, type Delivery } from "./delivery";
import type { CrewModels } from "./policy";
import { isIntegrator, type ResolvedMember } from "./spec";
import { memberRowId, type CrewRow, type MemberEnvRow, type MemberRow, type MergeRequestRow, type Store } from "./store";
import type { ThreadPort } from "./thread-port";

export type MergeOutcome = { ok: true; commit: string; parked?: boolean } | { ok: false; conflict: boolean; detail: string };
/** none = no parked merge; held = the checkout is still dirty; released = `base` now points at the parked commit. */
export type ReleaseOutcome = { kind: "none" | "held" } | { kind: "released"; commit: string } | { kind: "failed"; detail: string };
export type RebaseOutcome = { ok: true; head: string } | { ok: false; conflict: boolean; files: string[]; detail: string };

export interface GitBackend {
  /** Commits on `base` that `branch` does not have; null when git cannot say. */
  behind(cwd: string, branch: string, base: string): Promise<number | null>;
  /** Commits on `branch` that `base` does not have; null when git cannot say. */
  ahead(cwd: string, branch: string, base: string): Promise<number | null>;
  /** Uncommitted changes to tracked files in this worktree. */
  dirty(cwd: string): Promise<boolean>;
  /**
   * Run the checks command in the worktree. `ok` = exit 0. `env` = the
   * command itself could not run (exit 126/127, or it timed out/was
   * killed) — distinct from `failed`, a real red check. `code` is the raw
   * exit code (killed runs report 1), used for the done gate's log.
   */
  checks(cwd: string, command: string): Promise<{ kind: "ok" | "failed" | "env"; code: number; output: string }>;
  /** Merge `branch` into `base`; never leaves a half-done merge behind. */
  merge(cwd: string, branch: string, base: string, message: string): Promise<MergeOutcome>;
  /** Move `base` onto a merge parked behind a dirty checkout (BBP-271) once that checkout is clean; never touches a dirty one. */
  release(cwd: string, base: string): Promise<ReleaseOutcome>;
  /** Rebase the worktree's branch onto `base`; on conflict the rebase is aborted. */
  rebase(cwd: string, base: string): Promise<RebaseOutcome>;
}

type Run = (
  args: string[],
  cwd: string,
  options?: { timeoutMs?: number; shell?: boolean },
) => Promise<{ code: number; stdout: string; stderr: string; killed?: boolean }>;

// NODE_ENV is left out on purpose: the BB server runs with NODE_ENV=production,
// and a check command that shells out to vitest would load React's production
// builds under that, failing every render test with "React.act is not a function".
const runProcess: Run = (args, cwd, options = {}) =>
  new Promise((resolve) => {
    const [file, ...rest] = options.shell ? ["sh", "-c", args.join(" ")] : ["git", ...args];
    const { NODE_ENV: _omittedNodeEnv, ...env } = process.env;
    execFile(file!, rest, { cwd, timeout: options.timeoutMs ?? 60_000, maxBuffer: 8 * 1024 * 1024, env: { ...env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout, stderr) => {
      const killed = !!error && (error as { killed?: boolean }).killed === true;
      const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) || (error && code === 1 && !stderr ? error.message : ""), killed });
    });
  });

const tail = (text: string, max = 4000) => (text.length <= max ? text : `…${text.slice(-max)}`);
const tailLines = (text: string, lines: number) => text.split("\n").slice(-lines).join("\n");
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~])/g;
const stripAnsi = (text: string) => text.replace(ANSI_PATTERN, "");

/** Plain git through `child_process` — the server runs on the machine that holds the repository. */
export function createLocalGit(run: Run = runProcess): GitBackend {
  async function worktreeWith(cwd: string, base: string): Promise<string | null> {
    const list = await run(["worktree", "list", "--porcelain"], cwd);
    let current: string | null = null;
    for (const line of list.stdout.split("\n")) {
      if (line.startsWith("worktree ")) current = line.slice(9);
      else if (line === `branch refs/heads/${base}` && current) return current;
    }
    return null;
  }
  return {
    async behind(cwd, branch, base) {
      const result = await run(["rev-list", "--count", `${branch}..${base}`], cwd);
      const count = Number.parseInt(result.stdout.trim(), 10);
      return result.code === 0 && Number.isFinite(count) ? count : null;
    },
    async ahead(cwd, branch, base) {
      const result = await run(["rev-list", "--count", `${base}..${branch}`], cwd);
      const count = Number.parseInt(result.stdout.trim(), 10);
      return result.code === 0 && Number.isFinite(count) ? count : null;
    },
    async dirty(cwd) {
      const result = await run(["status", "--porcelain", "--untracked-files=no"], cwd);
      return result.code === 0 && result.stdout.trim() !== "";
    },
    async checks(cwd, command) {
      const result = await run([command], cwd, { shell: true, timeoutMs: 10 * 60_000 });
      const output = tail(stripAnsi(`${result.stdout}${result.stderr}`.trim()));
      if (result.code === 0) return { kind: "ok", code: result.code, output };
      const env = result.killed === true || result.code === 126 || result.code === 127;
      return { kind: env ? "env" : "failed", code: result.code, output };
    },
    async merge(cwd, branch, base, message) {
      // The merge commit is always built without a working tree (BBP-269); a checkout of the base only follows by fast-forward.
      const target = await worktreeWith(cwd, base);
      const dirty = !!target && (await run(["status", "--porcelain", "--untracked-files=no"], target)).stdout.trim() !== "";
      // An earlier merge parked behind a dirty checkout (BBP-270) is the base to build on, or it would be lost.
      const parkedRef = `refs/crew/integration/${base}`;
      const parked = await run(["rev-parse", "--verify", "--quiet", parkedRef], cwd);
      const parent = parked.code === 0 ? parked.stdout.trim() : (await run(["rev-parse", base], cwd)).stdout.trim();
      const tree = await run(["merge-tree", "--write-tree", parent, branch], cwd);
      if (tree.code !== 0) return { ok: false, conflict: tree.code === 1, detail: tail(tree.stdout.trim(), 1500) };
      const commit = await run(["commit-tree", tree.stdout.trim().split("\n")[0]!, "-p", parent, "-p", branch, "-m", message], cwd);
      if (commit.code !== 0) return { ok: false, conflict: false, detail: commit.stderr.trim() };
      const sha = commit.stdout.trim();
      if (dirty) {
        // Never stash and never move a checked-out branch under the human's files: park the commit instead (ADR 0004).
        const park = await run(["update-ref", parkedRef, sha, ...(parked.code === 0 ? [parent] : [])], cwd);
        if (park.code !== 0) return { ok: false, conflict: false, detail: park.stderr.trim() };
        return { ok: true, commit: sha, parked: true };
      }
      const old = (await run(["rev-parse", base], cwd)).stdout.trim();
      const update = target ? await run(["merge", "--ff-only", sha], target) : await run(["update-ref", `refs/heads/${base}`, sha, old], cwd);
      if (update.code !== 0) return { ok: false, conflict: false, detail: tail(`${update.stdout}${update.stderr}`.trim(), 1500) };
      if (parked.code === 0) await run(["update-ref", "-d", parkedRef], cwd);
      return { ok: true, commit: sha };
    },
    async release(cwd, base) {
      const parkedRef = `refs/crew/integration/${base}`;
      const parked = await run(["rev-parse", "--verify", "--quiet", parkedRef], cwd);
      if (parked.code !== 0) return { kind: "none" };
      const sha = parked.stdout.trim();
      const target = await worktreeWith(cwd, base);
      if (target && (await run(["status", "--porcelain", "--untracked-files=no"], target)).stdout.trim() !== "") return { kind: "held" };
      const old = (await run(["rev-parse", base], cwd)).stdout.trim();
      const update = target ? await run(["merge", "--ff-only", sha], target) : await run(["update-ref", `refs/heads/${base}`, sha, old], cwd);
      if (update.code !== 0) return { kind: "failed", detail: tail(`${update.stdout}${update.stderr}`.trim(), 1500) };
      await run(["update-ref", "-d", parkedRef, sha], cwd);
      return { kind: "released", commit: sha };
    },
    async rebase(cwd, base) {
      const result = await run(["rebase", base], cwd);
      if (result.code === 0) return { ok: true, head: (await run(["rev-parse", "HEAD"], cwd)).stdout.trim() };
      const files = (await run(["diff", "--name-only", "--diff-filter=U"], cwd)).stdout.split("\n").filter(Boolean);
      await run(["rebase", "--abort"], cwd);
      return { ok: false, conflict: files.length > 0 || /CONFLICT/.test(result.stdout + result.stderr), files, detail: tail(`${result.stdout}${result.stderr}`.trim(), 1500) };
    },
  };
}

// Backend selection (BBP-14). Git runs where the worktree is: the local
// backend shells out in the plugin server, which only reaches the BB server's
// own machine. A worktree on any other host — or on a host BB does not name —
// gets the remote backend. Until a host component exists (route: a `bb.host`
// entry called via `bb.hosts.experimental_client(...).call(m, input, { hostId })`)
// the remote backend refuses with a reason instead of running git against a
// path that does not exist on this machine.
export type BackendChoice = { ok: true; git: GitBackend } | { ok: false; hostId: string | null; reason: string };
/** Git for a worktree on a host other than the BB server's. */
export type RemoteGitFactory = (hostId: string) => BackendChoice;

export const unavailableLine = (hostId: string | null, why: string) => `integration unavailable on remote host ${hostId ?? "unknown"}: ${why}`;

/** Stub until BBP-14 part 2: every remote host reports "not available". */
export const unavailableRemoteGit: RemoteGitFactory = (hostId) => ({
  ok: false,
  hostId,
  reason: unavailableLine(hostId, "crew runs git in the BB server process and has no host component on that machine yet (BBP-14); merge, rebase and checks stay with the human"),
});

export function selectBackend(args: { hostId: string | null; localHostId: string | null; local: GitBackend; remote: RemoteGitFactory }): BackendChoice {
  const { hostId, localHostId } = args;
  if (hostId === null) return { ok: false, hostId: null, reason: unavailableLine(null, "BB does not name the worktree's host, so it is treated as remote") };
  if (localHostId === null) return { ok: false, hostId, reason: unavailableLine(hostId, "BB does not name its own host, so no worktree can be shown to be local") };
  return hostId === localHostId ? { ok: true, git: args.local } : args.remote(hostId);
}

export type IntegrationDeps = {
  store: Store;
  port: ThreadPort;
  models: CrewModels;
  delivery: Delivery;
  /** Backend for worktrees on the BB server's own machine. */
  git: GitBackend;
  /** Backend for every other host; defaults to the "not available" stub. */
  remote?: RemoteGitFactory;
  /** A merge landed: dependencies waiting for `merged` are checked right away. */
  onMerged?: (merge: MergeRequestRow) => Promise<void>;
  newId?: () => string;
  now?: () => number;
};

export type Integration = ReturnType<typeof createIntegration>;
export const AWAITING_HUMAN = ["open", "returned"] as const;
/** Consecutive red-check rejections for one crew before it escalates to the human. */
export const REJECT_LIMIT = 3;

/** One `gates.done` command's outcome, in the order it ran. */
export type GateStep = { command: string; kind: "ok" | "failed" | "env"; code: number; durationMs: number; output: string };
/** `ok`: every command was green. Red: aborted at the first non-ok command; `steps` holds everything run up to and including it. */
export type GateOutcome = { ok: true; steps: GateStep[] } | { ok: false; steps: GateStep[] };

export function createIntegration(deps: IntegrationDeps) {
  const { store, port, models, delivery } = deps;
  const remote = deps.remote ?? unavailableRemoteGit;
  const now = deps.now ?? Date.now;
  // Hosts do not move: an environment's host and the server's host are cached once known.
  const hostByEnvironment = new Map<string, string>();
  let localHost: string | null = null;

  async function localHostId(): Promise<string | null> {
    if (localHost === null) localHost = await port.localHostId().catch(() => null);
    return localHost;
  }

  async function hostOfEnvironment(environmentId: string): Promise<string | null> {
    const known = hostByEnvironment.get(environmentId);
    if (known) return known;
    const info = await port.environmentInfo(environmentId).catch(() => null);
    const hostId = info?.hostId ?? null;
    if (hostId) hostByEnvironment.set(environmentId, hostId);
    return hostId;
  }

  async function choose(hostId: string | null): Promise<BackendChoice> {
    return selectBackend({ hostId, localHostId: await localHostId(), local: deps.git, remote });
  }

  /** The backend for this worktree; a refusal is thrown as the reason. */
  async function gitFor(env: MemberEnvRow): Promise<GitBackend> {
    const choice = await choose(env.environmentId ? await hostOfEnvironment(env.environmentId) : null);
    if (!choice.ok) throw new AddressError(choice.reason);
    return choice.git;
  }
  const newId = deps.newId ?? (() => `mr_${randomBytes(4).toString("hex")}`);

  function lead(crew: CrewRow): MemberRow | null {
    return store.listMembers(crew.id).find((member) => member.lead) ?? null;
  }

  /** Where the member works. BB names worktree branches itself, so this is read from the environment, not assumed. */
  async function locate(member: MemberRow, refresh = false): Promise<MemberEnvRow | null> {
    const known = store.memberEnv(member.id);
    if (known && known.path && known.branch && !refresh) return known;
    const binding = store.currentBinding(member.id);
    const thread = binding ? await port.get(binding.threadId).catch(() => null) : null;
    // Right after spawn the worktree may still be provisioning: wait for it on an explicit refresh.
    const environmentId = thread?.environmentId ?? (thread && refresh ? await port.environmentOf(thread.id).catch(() => null) : null);
    if (!environmentId) return known;
    const info = await port.environmentInfo(environmentId).catch(() => null);
    if (!info) return known;
    if (info.hostId) hostByEnvironment.set(environmentId, info.hostId);
    store.setMemberEnv(member.id, { environmentId, path: info.path, branch: info.branch });
    return store.memberEnv(member.id);
  }

  function baseOf(crew: CrewRow): string {
    return models(crew).spec?.baseBranch ?? "main";
  }

  function integrators(projectId: string): MemberRow[] {
    return store
      .listCrews(projectId)
      .filter((crew) => crew.status === "running" || crew.status === "degraded")
      .flatMap((crew) => store.listMembers(crew.id))
      .filter((member) => isIntegrator(member.config));
  }

  function requireMerge(id: string): MergeRequestRow {
    const merge = store.getMerge(id);
    if (!merge) throw new AddressError(`There is no merge request "${id}".`);
    return merge;
  }

  async function returnToHuman(merge: MergeRequestRow, reason: string, checksOutput?: string): Promise<MergeRequestRow> {
    const returned = store.updateMerge(merge.id, { state: "returned", reason, ...(checksOutput !== undefined ? { checksOutput } : {}) });
    const crew = store.getCrew(merge.crewId);
    if (crew) tellLead(crew, `Merge request ${merge.id} returned to the human`, `${reason}\n\n${describe(crew, merge)}`);
    return returned;
  }

  /** "MR …, branch …, ticket …" — the facts a submitting lead needs to match the outcome to its delivery. */
  function describe(crew: CrewRow, merge: MergeRequestRow): string {
    const task = models(crew).spec?.task;
    return `MR ${merge.id}, branch ${merge.branch}${merge.commitSha ? `, commit ${merge.commitSha.slice(0, 10)}` : ""}${task ? `, ticket ${task}` : ""}`;
  }

  /** One waking message to the submitting crew's lead (BBP-250); skipped when the lead did it itself. */
  function tellLead(crew: CrewRow, subject: string, body: string, by?: string): void {
    const crewLead = lead(crew);
    if (!crewLead || crewLead.address === by) return;
    delivery.send({ projectId: crew.projectId, from: { kind: "system" }, to: crewLead.address, subject, body, crew: crew.name });
  }

  /** Red-check rejections this crew racked up right before `excludeId`, most recent first, stopping at a merge or a non-checks reason. */
  function consecutiveRedChecks(crewId: string, excludeId: string): number {
    const merges = store.listMerges({ crewId }).filter((row) => row.id !== excludeId);
    let count = 0;
    for (let i = merges.length - 1; i >= 0; i -= 1) {
      const row = merges[i]!;
      if (row.state === "merged") break;
      if (!row.reason?.startsWith("checks")) break;
      count += 1;
    }
    return count;
  }

  /** Red checks (test failures or an environment error): back to the crew lead, not the human — until this crew racks up too many in a row. */
  async function rejectChecks(merge: MergeRequestRow, crew: CrewRow, reason: string, output: string): Promise<MergeRequestRow> {
    const failures = consecutiveRedChecks(crew.id, merge.id) + 1;
    if (failures >= REJECT_LIMIT) return returnToHuman(merge, `${reason} (${REJECT_LIMIT} failed checks in a row; needs you)`, output);
    const rejected = store.updateMerge(merge.id, { state: "rejected", reason, checksOutput: output });
    const crewLead = lead(crew);
    if (crewLead) {
      delivery.send({
        projectId: crew.projectId,
        from: { kind: "system" },
        to: crewLead.address,
        subject: `Merge request ${merge.id}: checks failed`,
        body: `${reason} (${describe(crew, merge)})\n\n${tailLines(output, 40)}\n\nfix, then crew_deliver again`,
        crew: crew.name,
      });
    }
    return rejected;
  }

  async function perform(merge: MergeRequestRow, by: string): Promise<MergeRequestRow> {
    const crew = store.getCrew(merge.crewId)!;
    const crewLead = lead(crew);
    const env = crewLead ? await locate(crewLead) : null;
    if (!env?.path) return returnToHuman(merge, "the crew branch's worktree is unknown");
    const git = await gitFor(env);
    // A merge parked behind a dirty checkout (BBP-271) lands first, once that checkout is clean.
    const release = await git.release(env.path, merge.base);
    if (release.kind === "released") await settleParked(crew.projectId, merge.base, by);
    if (merge.state === "parked") return requireMerge(merge.id);
    const task = models(crew).spec?.task;
    const outcome = await git.merge(env.path, merge.branch, merge.base, `Merge ${merge.branch} (crew ${crew.name}${task ? `, ${task}` : ""}) into ${merge.base}`);
    if (!outcome.ok) return returnToHuman(merge, outcome.conflict ? `merge conflict: ${outcome.detail}` : `merge failed: ${outcome.detail}`);
    if (outcome.parked) {
      // Not merged: no "main moved", no dependency release; the lead waits on the human (merge-parked).
      const reason = `${merge.base} checkout has uncommitted changes; merge parked on refs/crew/integration/${merge.base}; commit or clean up, the next merge/approve releases it`;
      const parked = store.updateMerge(merge.id, { state: "parked", commitSha: outcome.commit, mergedBy: by, reason });
      tellLead(crew, `Merge request ${parked.id} parked`, `${describe(crew, parked)}: ${reason}.`, by);
      return parked;
    }
    // A merge on top of a parked ref takes it along (the ref is gone now), so those requests landed too.
    await settleParked(crew.projectId, merge.base, by);
    return landed(crew, store.updateMerge(merge.id, { state: "merged", commitSha: outcome.commit, mergedBy: by, reason: null }), by);
  }

  async function landed(crew: CrewRow, merged: MergeRequestRow, by: string): Promise<MergeRequestRow> {
    tellLead(crew, `Merge request ${merged.id} merged`, `${describe(crew, merged)} merged into ${merged.base} by ${by}.`, by);
    await mainMoved(crew, merged);
    await deps.onMerged?.(merged);
    return merged;
  }

  /** Every request parked on `base` is in `base` now: merged, each with its own "main moved" and dependency check. */
  async function settleParked(projectId: string, base: string, by: string): Promise<void> {
    for (const parked of store.listMerges({ projectId, states: ["parked"] })) {
      if (parked.base !== base) continue;
      const crew = store.getCrew(parked.crewId);
      if (crew) await landed(crew, store.updateMerge(parked.id, { state: "merged", reason: null }), by);
    }
  }

  /** Non-waking note to every other running crew's lead in the project (§3.9.1); the source crew got its own message. */
  async function mainMoved(source: CrewRow, merge: MergeRequestRow): Promise<void> {
    const task = models(source).spec?.task;
    for (const crew of store.listCrews(source.projectId)) {
      if (crew.id === source.id) continue;
      if (crew.status !== "running" && crew.status !== "degraded") continue;
      const crewLead = lead(crew);
      if (!crewLead) continue;
      delivery.send({
        projectId: crew.projectId,
        from: { kind: "system" },
        to: crewLead.address,
        kind: "system",
        subject: `${merge.base} moved`,
        body: `${merge.base} moved: crew ${source.name} merged ${merge.branch} (commit ${merge.commitSha?.slice(0, 10)}${task ? `, task ${task}` : ""}). Decide whether your crew rebases (crew_rebase).`,
        crew: crew.name,
      });
    }
  }

  /**
   * One line per host on which this crew's integration would not run. Bound
   * members are judged by their environment's host; members without a thread
   * yet by where `apply` would put them (`host:` placement, the lead's
   * environment when shared, otherwise the project's default source host).
   */
  async function remoteHosts(projectId: string, crew: CrewRow | null, members: readonly ResolvedMember[]): Promise<string[]> {
    const byReason = new Map<string, string[]>();
    let projectHost: Promise<string | null> | null = null;
    const predicted = (member: ResolvedMember): Promise<string | null> => {
      if (member.placement.kind === "host") return Promise.resolve(member.placement.hostId);
      projectHost ??= port.projectHostId(projectId).catch(() => null);
      return projectHost;
    };
    const hostFor = async (member: ResolvedMember): Promise<string | null> => {
      const row = crew ? store.getMember(memberRowId(crew.id, member.key)) : null;
      const env = row ? await locate(row).catch(() => null) : null;
      if (env?.environmentId) return hostOfEnvironment(env.environmentId);
      return predicted(member);
    };
    const lead = members.find((member) => member.lead);
    const leadHost = lead ? await hostFor(lead) : null;
    for (const member of members) {
      const hostId = member.lead || member.placement.kind === "shared" ? leadHost : await hostFor(member);
      const choice = await choose(hostId);
      if (choice.ok) continue;
      const list = byReason.get(choice.reason) ?? [];
      list.push(member.key);
      byReason.set(choice.reason, list);
    }
    return [...byReason].map(([reason, keys]) => `${reason} (members: ${keys.join(", ")})`);
  }

  /** `branch` has no commits that `base` lacks: the merge already happened outside this flow. False on any doubt. */
  async function isContained(merge: MergeRequestRow): Promise<boolean> {
    const crew = store.getCrew(merge.crewId);
    const crewLead = crew ? lead(crew) : null;
    const env = crewLead ? await locate(crewLead) : null;
    if (!env?.path) return false;
    try {
      const git = await gitFor(env);
      const ahead = await git.ahead(env.path, merge.branch, merge.base);
      return ahead === 0;
    } catch {
      return false;
    }
  }

  return {
    locate,
    remoteHosts,
    integrators,
    baseOf,

    /** The lead asks to merge its crew branch. Idempotent: an open request is returned as it is. */
    async request(crew: CrewRow, requestedBy: string): Promise<{ merge: MergeRequestRow; integrator: MemberRow | null; warnings: string[] }> {
      const existing = store.listMerges({ crewId: crew.id, states: AWAITING_HUMAN })[0];
      if (existing) return { merge: existing, integrator: null, warnings: [`merge request ${existing.id} is already ${existing.state}`] };
      const crewLead = lead(crew);
      const env = crewLead ? await locate(crewLead, true) : null;
      const base = baseOf(crew);
      if (!env?.path || !env.branch) throw new AddressError("The crew branch is unknown: the lead's thread has no worktree environment.");
      if (env.branch === base) throw new AddressError(`The crew works directly on ${base}; there is nothing to merge.`);
      // A remote worktree refuses here: no request is stored, the human keeps the merge.
      const git = await gitFor(env);
      const warnings: string[] = [];
      if (await git.dirty(env.path).catch(() => false)) warnings.push("the crew worktree has uncommitted changes; only committed work is merged");
      const merge = store.insertMerge({ id: newId(), projectId: crew.projectId, crewId: crew.id, branch: env.branch, base, requestedBy });
      const integrator = integrators(crew.projectId)[0] ?? null;
      if (integrator) {
        const integratorCrew = store.getCrew(integrator.crewId)!;
        delivery.send({
          projectId: crew.projectId,
          from: { kind: "system" },
          to: integrator.address,
          subject: `Merge request ${merge.id}: ${crew.name}`,
          body: `Crew ${crew.name} asks to merge ${merge.branch} into ${base}. Call crew_merge(id: "${merge.id}"): it runs the checks and merges only when they are green.`,
          crew: integratorCrew.name,
        });
      }
      return { merge, integrator, warnings };
    },

    /** Human approves: merge now. A failed merge comes back as `returned` with the reason. */
    async approve(id: string): Promise<MergeRequestRow> {
      const merge = requireMerge(id);
      // A parked request is approved again once its checkout is clean: that only releases it (BBP-271).
      if (!(AWAITING_HUMAN as readonly string[]).includes(merge.state) && merge.state !== "parked") throw new AddressError(`Merge request ${id} is ${merge.state}.`);
      return perform(merge, "human");
    },

    /** The integrator merges — only on green checks; everything else goes back to the human. */
    async integratorMerge(id: string, integrator: MemberRow): Promise<MergeRequestRow> {
      if (!isIntegrator(integrator.config)) throw new AddressError("Only a member marked integrator: true merges.");
      const merge = requireMerge(id);
      if (merge.state !== "open") throw new AddressError(`Merge request ${id} is ${merge.state}; it is the human's now.`);
      const crew = store.getCrew(merge.crewId)!;
      const crewLead = lead(crew);
      const env = crewLead ? await locate(crewLead) : null;
      // A remote worktree refuses before anything else, so the request stays `open` as it was.
      const git = env?.path ? await gitFor(env) : null;
      const command = models(crew).spec?.checks;
      if (!command) return returnToHuman(merge, "the crew file defines no checks command; the integrator merges only on green checks");
      if (!env?.path || !git) return returnToHuman(merge, "the crew branch's worktree is unknown");
      const result = await git.checks(env.path, command);
      if (result.kind !== "ok") {
        const reason = `checks ${result.kind === "env" ? "could not run (environment)" : "failed"}: ${command}`;
        return rejectChecks(merge, crew, reason, result.output);
      }
      store.updateMerge(merge.id, { checksOutput: result.output });
      return perform(store.getMerge(id)!, integrator.address);
    },

    async reject(id: string, note: string): Promise<MergeRequestRow> {
      const merge = requireMerge(id);
      if (!(AWAITING_HUMAN as readonly string[]).includes(merge.state)) throw new AddressError(`Merge request ${id} is ${merge.state}.`);
      const after = store.updateMerge(id, { state: "rejected", reason: note || "rejected by the human" });
      const crew = store.getCrew(merge.crewId)!;
      const crewLead = lead(crew);
      if (crewLead) {
        delivery.send({
          projectId: crew.projectId,
          from: { kind: "human" },
          to: crewLead.address,
          subject: `Merge request ${id} rejected`,
          body: `The human rejected merging ${merge.branch}${note ? `: ${note}` : "."}\n\n${describe(crew, merge)}`,
          crew: crew.name,
        });
      }
      return after;
    },

    /**
     * `gates.done`: run `commands` in order in the member's own worktree,
     * aborting at the first non-ok one. Remote host or missing worktree
     * throws instead of skipping the gate (BBP-176): there is no bypass.
     */
    async runDoneGate(member: MemberRow, commands: readonly string[]): Promise<GateOutcome> {
      const env = await locate(member);
      if (!env?.path) throw new AddressError("your worktree is unknown; the done gate cannot run");
      const git = await gitFor(env);
      const steps: GateStep[] = [];
      for (const command of commands) {
        const startedAt = now();
        const result = await git.checks(env.path, command);
        steps.push({ command, kind: result.kind, code: result.code, durationMs: now() - startedAt, output: result.output });
        if (result.kind !== "ok") return { ok: false, steps };
      }
      return { ok: true, steps };
    },

    /** Rebase the member's worktree onto the base. A conflict aborts the rebase and puts the member on Needs you. */
    async rebase(member: MemberRow): Promise<RebaseOutcome & { base: string }> {
      const crew = store.getCrew(member.crewId)!;
      const base = baseOf(crew);
      const env = await locate(member, true);
      if (!env?.path) throw new AddressError("Your worktree is unknown; nothing to rebase.");
      const git = await gitFor(env);
      const outcome = await git.rebase(env.path, base);
      if (outcome.ok) store.clearNeed(member.id, "merge-conflict");
      else store.setNeed(member.id, "merge-conflict", outcome.files.length ? `conflicts in ${outcome.files.join(", ")}` : outcome.detail.slice(0, 300));
      return { ...outcome, base };
    },

    /** Commits the crew branch lags behind the base; null when unknown (no worktree yet). */
    async behind(crew: CrewRow): Promise<number | null> {
      const crewLead = lead(crew);
      const env = crewLead ? await locate(crewLead) : null;
      if (!env?.path || !env.branch) return null;
      const git = await gitFor(env).catch(() => null);
      if (!git) return null;
      return git.behind(env.path, env.branch, baseOf(crew)).catch(() => null);
    },

    /**
     * Merge requests waiting on the human, with the ones whose branch is
     * already fully contained in `base` (merged outside this flow, e.g. the
     * human merged the branch directly) closed as `merged` first (BBP-87):
     * they no longer belong on Needs you.
     */
    async awaitingHuman(crewId: string): Promise<MergeRequestRow[]> {
      const rows = store.listMerges({ crewId, states: AWAITING_HUMAN });
      const kept: MergeRequestRow[] = [];
      for (const merge of rows) {
        if (await isContained(merge)) store.updateMerge(merge.id, { state: "merged", reason: null, mergedBy: "git (already in base)" });
        else kept.push(merge);
      }
      return kept;
    },
  };
}

export function formatMerge(merge: MergeRequestRow, crewName: (id: string) => string): string {
  return `${merge.id} [${merge.state}] ${crewName(merge.crewId)}: ${merge.branch} → ${merge.base}${merge.commitSha ? ` @${merge.commitSha.slice(0, 10)}` : ""}${
    merge.mergedBy ? ` by ${merge.mergedBy}` : ""
  }${merge.reason ? ` — ${merge.reason}` : ""}`;
}

/** Test double: scripted outcomes, recorded calls. */
export function createFakeGit() {
  const calls: { method: string; args: unknown[] }[] = [];
  const fake = {
    calls,
    behindCount: 0 as number | null,
    // Non-zero by default: a freshly requested merge has unmerged commits.
    aheadCount: 1 as number | null,
    isDirty: false,
    checksResult: { kind: "ok", code: 0, output: "ok" } as { kind: "ok" | "failed" | "env"; code: number; output: string },
    // Consumed in call order, one per `checks` call; falls back to `checksResult` once empty — for gate tests that need a different result per command.
    checksResults: [] as { kind: "ok" | "failed" | "env"; code: number; output: string }[],
    mergeResult: { ok: true, commit: "abc1234def" } as MergeOutcome,
    rebaseResult: { ok: true, head: "fff000" } as RebaseOutcome,
    releaseResult: { kind: "none" } as ReleaseOutcome,
    count: (method: string) => calls.filter((call) => call.method === method).length,
    async behind(...args: [string, string, string]) {
      calls.push({ method: "behind", args });
      return fake.behindCount;
    },
    async ahead(...args: [string, string, string]) {
      calls.push({ method: "ahead", args });
      return fake.aheadCount;
    },
    async dirty(...args: [string]) {
      calls.push({ method: "dirty", args });
      return fake.isDirty;
    },
    async checks(...args: [string, string]) {
      calls.push({ method: "checks", args });
      return fake.checksResults.shift() ?? fake.checksResult;
    },
    async merge(...args: [string, string, string, string]) {
      calls.push({ method: "merge", args });
      return fake.mergeResult;
    },
    async release(...args: [string, string]) {
      calls.push({ method: "release", args });
      return fake.releaseResult;
    },
    async rebase(...args: [string, string]) {
      calls.push({ method: "rebase", args });
      return fake.rebaseResult;
    },
  };
  return fake satisfies GitBackend & Record<string, unknown>;
}
export type FakeGit = ReturnType<typeof createFakeGit>;
