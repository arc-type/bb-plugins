// The task-dev compiler: a reviewed run spec becomes graphs.
//
// The run spec is the plan an agent writes for one ticket — groups of
// sub-tasks ("tracks"), the critics each track gets, the stacked PR layers.
// Before this, a workflow script interpreted the spec at run time, so the run
// could not be seen before it started and could not be resumed where it
// stopped. Compiled, every step is a node: the canvas shows exactly what will
// run, the checkpointer resumes it, a question pauses one branch.
//
// Shape (one parent graph, one embedded graph per track):
//
//   preflight → group A fork → lanes of tracks → join → integrate → group gate
//             → group B fork → …                                → final review
//             → layer gates → submit
//
//   track: worktree → implement → gate ⇄ gate fix
//                                  └ ok → critics (fan-out per lens) → fix ↺ gate
//                                                                  └ clean → squash
//
// Three things keep a run legible and cheap (all measured on a real demo run,
// where 21 worker threads and 36 parent nodes made three tiny tracks hard to
// follow):
//
// - Threads are continued, not respawned (`continueThread`): the gate fix and
//   the findings fix are sent into the implementer's own thread, and each
//   critic lens keeps one thread across review rounds. One implementer per
//   track instead of one per step.
// - Contingencies are marked `path: "fallback"` — the resolver, the fixes for
//   a red gate, every "needs you" — so a run view draws them only once they
//   happen. And there are fewer of them: one stack fixer per group handles
//   both a pick conflict and a red gate, and every stage has one approval.
// - The graphs are tagged `dynamic` and spawn hidden workers: they are made
//   for one ticket, and neither the library nor the sidebar should fill up
//   with them.
//
// Tracks are subgraphs because a track contains cycles, and a join only waits
// for branches that run exactly once (see `joinSources`); from the parent a
// subgraph node is one step, so the group's join holds.
//
// Deterministic steps are command nodes calling the repository's helper
// (`.bb/workflows/lib/task-dev.sh` in ARC-4), which prints one JSON object per
// call. Paths are relative to the run's environment root.
import { z } from "zod";
import {
  DYNAMIC_TAG,
  END_NODE,
  REASONING_LEVELS,
  START_NODE,
  graphSchema,
  shellQuote,
  type Graph,
} from "./graph";

/* ── the run spec ──────────────────────────────────────────────────────── */

const modelSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  reasoningLevel: z.enum(REASONING_LEVELS).optional(),
});

const trackSchema = z.object({
  key: z.string().trim().min(1).max(30),
  title: z.string().trim().default(""),
  app: z.string().trim().min(1),
  spec: z.string().default(""),
  files: z.array(z.string()).default([]),
  critics: z.array(z.string()).default([]),
  extraSteps: z.array(z.string()).default([]),
  humanGates: z.array(z.string()).default([]),
  maxRounds: z.number().int().min(1).max(4).default(3),
  commitType: z.string().trim().default("feat"),
});

export const runSpecSchema = z.object({
  ticket: z.string().trim().min(1).max(30),
  title: z.string().default(""),
  acceptance: z.string().default(""),
  maxParallel: z.number().int().min(1).max(6).default(3),
  dryRun: z.boolean().default(false),
  apps: z.array(z.string().trim().min(1)).optional(),
  groups: z
    .array(z.object({ letter: z.string().trim().min(1).max(3), tracks: z.array(trackSchema).min(1) }))
    .min(1),
  layers: z.array(z.object({ branch: z.string().trim().min(1), tracks: z.array(z.string()).min(1) })).min(1),
  finalReview: z
    .object({ lenses: z.array(z.string()).default(["acceptance", "correctness", "security", "readability"]) })
    .default({ lenses: ["acceptance", "correctness", "security", "readability"] }),
  checkpoints: z.object({ afterGroups: z.array(z.string()).default([]) }).default({ afterGroups: [] }),
  decisions: z.record(z.string(), z.string()).default({}),
  models: z.record(z.string(), modelSchema).default({}),
  /** Docs a worker reads first, per app. Unset: the app's AGENTS.md. */
  appDocs: z.record(z.string(), z.string()).default({}),
});
export type RunSpec = z.infer<typeof runSpecSchema>;
type Track = RunSpec["groups"][number]["tracks"][number] & { group: string };

export type CompileOptions = {
  /** The helper script, relative to the environment root. */
  helper?: string;
  apps?: string[];
};

export type CompiledRun = {
  graph: Graph;
  /** One embedded graph per track; save them before the parent. */
  children: Graph[];
  /** Per group, the lanes that run side by side, each a list of track keys in order. */
  plan: Array<{ group: string; lanes: string[][] }>;
};

export type CompileResult = { ok: true; run: CompiledRun } | { ok: false; errors: string[] };

export const DEFAULT_HELPER = ".bb/workflows/lib/task-dev.sh";

const DEFAULT_MODELS: Record<string, z.infer<typeof modelSchema>> = {
  implementer: { provider: "codex", model: "gpt-6.1-sol", reasoningLevel: "high" },
  critic: { provider: "claude-code", model: "claude-opus-5-5", reasoningLevel: "medium" },
  coordinator: { provider: "claude-code", model: "claude-sonnet-5-5", reasoningLevel: "medium" },
};

/* ── texts carried over from the task-dev workflow ─────────────────────── */

export const LENSES: Record<string, string> = {
  "spec-tests":
    "Spec and tests. Does the diff do everything the sub-task's spec and done criteria ask, and stay inside its scope? Are the tests meaningful (they would fail if the behaviour broke, they cover the edge cases the spec names, none is tautological or skipped)? Were the docs the spec names updated in the same change?",
  correctness:
    "Correctness and repo rules. Real bugs, wrong error handling, races, missing cancellation or cleanup, broken contracts with callers. Breaches of the app's AGENTS.md and the docs it routes to.",
  readability:
    "Readability and decomposition, by the repository's own rule: SlopCop `pr-blame`. Load it with `bb slopcop rules --json | jq -r '.[] | select(.name==\"pr-blame\") | .prompt'` and apply its review criteria, what it looks for and how it judges severity; skip its output format. Map its High to blocking, Medium to should-fix, Low to nit. It also flags over-decomposition, so simplify in both directions.",
  security:
    "Security and silent failures. Input validation at trust boundaries, authz checks, secret handling, injection, unsafe uploads; errors swallowed, fallbacks that hide failure, missing user-visible error states.",
  a11y: "Accessibility. Semantics, labels, focus order and visibility, keyboard paths, announced state changes, contrast via tokens, hit targets.",
  performance:
    "Performance. Needless re-renders, work in render paths, unbounded lists, missing abort of in-flight work, N+1 calls, oversized payloads.",
  "data-migration":
    "Data and migrations. Schema and RLS correctness, reversibility, defaults and backfills, generated types and API contracts kept in sync.",
  acceptance:
    "Acceptance. Walk every acceptance criterion of the parent ticket and say where the stack satisfies it; report each criterion that is missing or only partly met, and any sub-task whose seams with another sub-task do not fit.",
};

const TRACK_LENSES = ["spec-tests", "correctness", "readability"];

const COLLABORATION = `You review alongside the implementer and share one goal: a correct, readable change we can ship.
- Every finding names the exact place (file:line), what is wrong, why it matters, and a concrete fix.
- Severity: blocking = breaks the spec or a done criterion, a real bug, a broken repo rule, or code a reader cannot follow; should-fix = a clear improvement this change should carry; nit = optional polish.
- Taste, hypothetical future needs, work outside this scope and anything lint already enforces are not findings.
- Verify each claim in the code before you report it. An empty list is a valid answer.
- On a re-review, drop resolved findings, accept a decline with a sound reason, and raise a new finding only when the fix introduced it or it truly matters.`;

const READABLE_CODE =
  "Write code a reader understands top to bottom: intent first, mechanics behind well-named functions; named conditions; no nested ternaries; one status value instead of several booleans; derived values instead of synced state; no trivial one-use helpers or pass-through layers.";

const SANDBOX =
  'If a command fails only because the sandbox blocked it (network, or EPERM / "Operation not permitted" outside the workspace), run it again outside the sandbox.';

/** Per-prompt ceilings, so a long spec cannot push a prompt past the node limit. */
const SPEC_CHARS = 3200;
const ACCEPTANCE_CHARS = 1500;

/* ── validation (the rules the workflow engine enforced) ───────────────── */

export function specErrors(spec: RunSpec): string[] {
  const errors: string[] = [];
  if (spec.apps) {
    for (const track of spec.groups.flatMap(group => group.tracks)) {
      if (!spec.apps.includes(track.app)) errors.push(`unknown app "${track.app}" for ${track.key}; allowed: ${spec.apps.join(", ")}`);
    }
  }
  const keys = spec.groups.flatMap((group) => group.tracks.map((track) => track.key));
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length) errors.push(`duplicate track keys: ${[...new Set(duplicates)].join(", ")}`);
  const letters = spec.groups.map((group) => group.letter);
  if (letters.some((letter, index) => index > 0 && letter <= letters[index - 1]!)) {
    errors.push(`group letters must ascend: ${letters.join(", ")}`);
  }
  const groupOf = new Map(spec.groups.flatMap((group) => group.tracks.map((track) => [track.key, group.letter] as const)));
  const layered = spec.layers.flatMap((layer) => layer.tracks);
  for (const key of keys) {
    const count = layered.filter((entry) => entry === key).length;
    if (count !== 1) errors.push(`track ${key} sits in ${count} layers; it must sit in exactly one`);
  }
  for (const key of layered) {
    if (!groupOf.has(key)) errors.push(`layer track ${key} is not a track of any group`);
  }
  let lastGroup = "";
  for (const key of layered) {
    const letter = groupOf.get(key);
    if (!letter) continue;
    if (letter < lastGroup) errors.push(`layers go back from group ${lastGroup} to ${letter} at ${key}`);
    lastGroup = letter > lastGroup ? letter : lastGroup;
  }
  const lenses = [
    ...spec.finalReview.lenses,
    ...spec.groups.flatMap((group) => group.tracks.flatMap((track) => track.critics)),
  ];
  for (const lens of new Set(lenses)) {
    if (!LENSES[lens]) errors.push(`unknown lens "${lens}"; known: ${Object.keys(LENSES).join(", ")}`);
  }
  return errors;
}

/* ── compile ───────────────────────────────────────────────────────────── */

type Draft = Record<string, unknown> & { id: string; label: string };
type DraftEdge = Record<string, unknown> & { from: string; to: string };

/** `ARC-5` → `arc-5`; ids must start with a letter. */
function slug(value: string): string {
  const out = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(out) ? out : `t-${out}`;
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[…cut; read the full text in the ticket]`;
}

function sections(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join("\n\n");
}

const field = (name: string, description = "", type = "string", options: string[] = []) => ({
  name,
  type,
  description,
  ...(options.length ? { options } : {}),
});
/**
 * A question only means something when the status asks for a person. Made
 * optional because a worker reporting DONE reasonably leaves it out — which
 * used to fail the attempt with "Field \"question\" is missing".
 */
const helperKind = () => ({ ...field("kind", "red, conflict, or error; absent on success and older helpers"), optional: true });
const question = (description: string) => ({ ...field("question", description), optional: true });
/** Every compiled graph is for one ticket: kept out of the library listings. */
const tagsFor = (ticket: string) => [DYNAMIC_TAG, `ticket:${slug(ticket)}`.slice(0, 40)];
const isTrue = (key: string) => ({ source: "field", key, op: "equals", value: "true" });
const isValue = (key: string, value: string) => ({ source: "field", key, op: "equals", value });
const visitsBelow = (key: string, value: number) => ({ source: "output", key, op: "visitsBelow", value: String(value) });
/** A literal list printed as the `lenses` field of a command node. */
function listCommand(name: string, values: string[]): string {
  return `printf '%s\\n' ${shellQuote(JSON.stringify({ [name]: values }))}`;
}

/**
 * Tracks whose files overlap build on each other, in spec order, so they form
 * one chain; the rest are independent. Same rule as the workflow engine.
 */
function chains(tracks: Track[]): Track[][] {
  const out: Track[][] = [];
  for (const track of tracks) {
    const chain = out.find((existing) => existing.some((other) => filesOverlap(other.files, track.files)));
    if (chain) chain.push(track);
    else out.push([track]);
  }
  return out;
}

function filesOverlap(a: string[], b: string[]): boolean {
  const root = (path: string) => path.replace(/\*.*$/, "");
  return a.some((x) => b.some((y) => root(x).startsWith(root(y)) || root(y).startsWith(root(x))));
}

/** Chains spread over at most `width` lanes, the shortest lane taking the next chain. */
function lanes(groupChains: Track[][], width: number): Track[][][] {
  const count = Math.max(1, Math.min(width, groupChains.length));
  const out: Track[][][] = Array.from({ length: count }, () => []);
  const size = (lane: Track[][]) => lane.reduce((sum, chain) => sum + chain.length, 0);
  for (const chain of [...groupChains].sort((a, b) => b.length - a.length)) {
    const lane = out.reduce((best, candidate) => (size(candidate) < size(best) ? candidate : best));
    lane.push(chain);
  }
  return out.filter((lane) => lane.length > 0);
}

export function compileRunSpec(input: unknown, options: CompileOptions = {}): CompileResult {
  const parsed = runSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "spec"}: ${issue.message}`),
    };
  }
  const spec = { ...parsed.data, ...(options.apps ? { apps: options.apps } : {}) };
  const errors = specErrors(spec);
  if (errors.length) return { ok: false, errors };

  const helper = options.helper ?? DEFAULT_HELPER;
  const H = shellQuote(helper);
  const ticket = spec.ticket;
  const graphId = `td-${slug(ticket)}`;
  const dir = `.worktrees/${ticket.toLowerCase()}`;
  const stack = `${dir}/_stack`;
  const trackDir = (key: string) => `${dir}/${key.toLowerCase()}`;
  const headOf = (path: string) => `"$(git -C ${shellQuote(path)} rev-parse HEAD)"`;

  const tracks: Track[] = spec.groups.flatMap((group) => group.tracks.map((track) => ({ ...track, group: group.letter })));
  const byKey = new Map(tracks.map((track) => [track.key, track]));
  const sequence = spec.layers.flatMap((layer) => layer.tracks);
  const layerEnd = new Map(spec.layers.map((layer) => [layer.tracks[layer.tracks.length - 1]!, layer.branch]));
  const describeTrack = (key: string) => `${key} ${byKey.get(key)?.title ?? ""}`.trim();
  const appsOf = (keys: string[]) => [...new Set(keys.map((key) => byKey.get(key)!.app))];

  const model = (role: string) => {
    const chosen = spec.models[role] ?? DEFAULT_MODELS[role]!;
    return {
      providerId: chosen.provider,
      model: chosen.model,
      reasoningLevel: chosen.reasoningLevel ?? null,
    };
  };
  const appDocs = (app: string) =>
    spec.appDocs[app] ?? `apps/${app}/AGENTS.md and the docs it routes this task to`;
  const decision = (key: string) =>
    spec.decisions[key] ? `## Maintainer decision (apply it; it overrides earlier findings)\n${spec.decisions[key]}` : "";
  const subTask = (track: Track, heading: string) => `${heading}\n${clip(track.spec, SPEC_CHARS)}`;
  const extraSteps = (track: Track) =>
    track.extraSteps.length ? `Required extra steps:\n${track.extraSteps.map((step) => `- ${step}`).join("\n")}` : "";
  const gates = (track: Track) => {
    const base = "cross none of the gates in the app's AGENTS.md";
    return track.humanGates.length ? `${base}, nor these: ${track.humanGates.join("; ")}` : base;
  };
  const gateCommand = (path: string, apps: string[], level: string) =>
    apps.map((app) => `${H} gate ${shellQuote(path)} ${shellQuote(app)} ${level}`).join(" && ");

  /* ── one track ── */
  const compileTrack = (track: Track, base: string): Graph => {
    const p = slug(track.key);
    const id = (name: string) => `${p}-${name}`;
    const rounds = track.maxRounds;
    const lenses = track.critics.length ? track.critics : TRACK_LENSES;
    const wt = id("wt");
    const where = `Worktree: {{${wt}.path}} (your working directory; base {{${wt}.base}}). Other sub-tasks run in parallel in their own worktrees; never touch them or the main checkout.`;
    const commit = `${track.commitType}(${track.app}): ${track.key} ${track.title}\n\nPart of ${ticket}.`;

    const nodes: Draft[] = [
      { id: id("review-round"), label: `${track.key} · review round`, kind: "note", maxVisits: rounds },
      { id: id("red-round"), label: `${track.key} · gate repair round`, kind: "note", path: "fallback", maxVisits: rounds + 1 },
      {
        id: wt,
        label: `${track.key} · worktree`,
        kind: "command",
        command: `${H} worktree ${shellQuote(ticket)} ${shellQuote(track.key)} ${headOf(base)}`,
        timeoutMinutes: 20,
        failOnExit: false,
        fields: [field("ok", "", "boolean"), helperKind(), ...["path", "branch", "base"].map(name => ({ ...field(name), optional: true }))],
        maxAttempts: 2,
      },
      {
        id: id("impl"),
        label: `${track.key} · implement`,
        cwd: `{{${wt}.path}}`,
        ...model("implementer"),
        // Back here after every answer from the maintainer, in the same
        // thread: the answer lands where the work and the question are.
        continueThread: id("impl"),
        maxVisits: 12,
        maxAttempts: 2,
        fields: [
          field("status", "DONE when implemented and committed", "enum", ["DONE", "NEEDS_HUMAN", "BLOCKED"]),
          field("summary", "what changed: files, tests, docs"),
          question("for NEEDS_HUMAN or BLOCKED: one precise question"),
        ],
        prompt: sections(
          `You implement one sub-task of ticket ${ticket} (${spec.title}) in an isolated git worktree.`,
          `${where} The worktree may already contain your earlier work on this sub-task: continue from it.`,
          `First read ${appDocs(track.app)} inside the worktree, and follow them.`,
          subTask(track, `## Sub-task ${track.key} — ${track.title} (group ${track.group})`),
          `Planned files and areas: ${track.files.join(", ") || "see the spec"}. Stay inside them: parallel tracks own other files.`,
          extraSteps(track),
          `## Parent ticket context (implement only this sub-task)\n${clip(spec.acceptance, ACCEPTANCE_CHARS)}`,
          `## How\n- Write the code, the tests and the doc updates this sub-task requires.\n- ${READABLE_CODE}\n- Validate with targeted commands; the full gate runs after you.\n- Commit in the worktree; several commits are fine, they get squashed.\n- ${SANDBOX}\n- Maintainer gates: ${gates(track)}. When the work needs one, return NEEDS_HUMAN with one precise question. Return BLOCKED when the spec cannot be done as written.`,
          decision(track.key),
          `The maintainer's answer to your last question, or guidance after the work got stuck, if any: {{${id("ask")}}}`,
        ),
      },
      {
        id: id("gate"),
        label: `${track.key} · gate`,
        kind: "command",
        // The placeholder renders as one quoted word by itself.
        command: `${H} gate {{${wt}.path}} ${shellQuote(track.app)} track`,
        failOnExit: false,
        timeoutMinutes: 60,
        maxVisits: 2 * rounds + 12,
        maxAttempts: 1,
        fields: [field("ok", "every gate step passed", "boolean"), helperKind()],
      },
      {
        id: id("gatefix"),
        label: `${track.key} · fix gate`,
        path: "fallback",
        cwd: `{{${wt}.path}}`,
        ...model("implementer"),
        continueThread: id("impl"),
        maxVisits: rounds + 11,
        fields: [
          field("status", "FIXED when committed", "enum", ["FIXED", "NEEDS_HUMAN"]),
          field("summary"),
          question("for NEEDS_HUMAN"),
        ],
        prompt: sections(
          `You implemented sub-task ${track.key} (${track.title}) of ticket ${ticket}. ${where}`,
          `Gate repair round {{visits.${id("red-round")}}} of ${rounds + 1}. The deterministic gate is red. Make it green. Its result (JSON; each failed step names its log file and the tail of it):\n{{${id("gate")}}}`,
          subTask(track, "Sub-task spec, for reference:"),
          decision(track.key),
          `- ${READABLE_CODE}\n- Re-run the failing command; commit your fixes in the worktree.\n- ${SANDBOX}`,
          "Return FIXED with a summary, or NEEDS_HUMAN with one question when a maintainer gate blocks the fix.",
        ),
      },
      {
        id: id("lenses"),
        label: `${track.key} · critique (${lenses.length})`,
        kind: "command",
        command: listCommand("lenses", lenses),
        maxVisits: rounds,
        maxAttempts: 1,
        fields: [field("lenses", "one critic per lens", "list")],
      },
      {
        id: id("critic"),
        label: `${track.key} · critic`,
        cwd: `{{${wt}.path}}`,
        ...model("critic"),
        // One thread per lens, round after round: a re-review in the thread
        // that holds the first review knows which findings were its own.
        continueThread: id("critic"),
        maxVisits: rounds,
        prompt: sections(
          `Review one sub-task of ticket ${ticket}, through one lens: {{item}}.`,
          COLLABORATION,
          `## The lenses (apply only yours)\n${lenses.map((lens) => `- ${lens}: ${LENSES[lens]}`).join("\n")}`,
          `## What to review\n${where} The change is \`git diff {{${wt}.base}}...HEAD\` plus uncommitted work. The app's rules: ${appDocs(track.app)}. Change nothing.`,
          subTask(track, `Sub-task ${track.key} — ${track.title}:`),
          extraSteps(track),
          decision(track.key),
          `The implementer's answer to the previous round, if any:\n{{${id("fix")}.summary}}`,
          "Answer with a one-paragraph summary, then each finding as: [id] severity — file:line, problem, suggested fix. Reuse an id when an earlier finding is still open.",
        ),
      },
      {
        id: id("fix"),
        label: `${track.key} · address findings`,
        cwd: `{{${wt}.path}}`,
        ...model("implementer"),
        continueThread: id("impl"),
        maxVisits: rounds + 11,
        fields: [
          field("status", "CLEAN: nothing must be fixed; FIXED: fixes committed", "enum", ["CLEAN", "FIXED", "NEEDS_HUMAN"]),
          field("summary", "one response per finding id: fixed or declined, with the reason"),
          question("for NEEDS_HUMAN"),
        ],
        prompt: sections(
          `You implemented sub-task ${track.key} (${track.title}) of ticket ${ticket}. ${where} The gate is green.`,
          `Review repair round {{visits.${id("review-round")}}} of ${rounds}. The reviewers' findings (they share your goal; their fixes are suggestions you may improve on):\n{{${id("critic")}}}`,
          `Must fix: every blocking finding${rounds > 1 ? ", and should-fix findings in the first two rounds" : ""}. For every finding, either fix it or decline it with a concrete reason. Effort alone is not a reason.`,
          subTask(track, "Sub-task spec, for reference:"),
          decision(track.key),
          `- ${READABLE_CODE}\n- Re-run the tests you touched; commit your fixes in the worktree.\n- ${SANDBOX}`,
          "Return CLEAN when nothing had to change (only nits, or every finding declined with a reason), FIXED when you committed fixes, NEEDS_HUMAN with a question when a maintainer gate blocks a fix.",
        ),
      },
      {
        // The track's one approval: a question from the implementer, a gate
        // that stays red, or review rounds spent. The answer goes back to the
        // implementer's own thread, which is where all three come from.
        id: id("ask"),
        label: `${track.key} · needs you`,
        kind: "human",
        path: "fallback",
        maxVisits: 10,
        prompt: `${track.key} (${track.title}) needs you (review round {{visits.${id("review-round")}}} of ${rounds}; gate repair round {{visits.${id("red-round")}}} of ${rounds + 1}): the implementer has a question, the gate stays red, or the review rounds (${rounds}) are spent.\n\nGate passed: {{${id("gate")}.ok}}\nQuestion: {{${id("impl")}.question}} {{${id("gatefix")}.question}} {{${id("fix")}.question}}\nLast summary: {{${id("fix")}.summary}}\n\nAnswer with a decision or guidance; the implementer goes on with it and the gate runs again. Stop the run to give up.`,
      },
      {
        id: id("squash"),
        label: `${track.key} · squash`,
        kind: "command",
        command: `${H} squash {{${wt}.path}} {{${wt}.base}} ${shellQuote(commit)}`,
        maxAttempts: 2,
        failOnExit: false,
        fields: [field("ok", "", "boolean"), helperKind(), { ...field("sha", "the squashed commit"), optional: true }],
      },
    ];

    const ask = nodes.find(node => node.id === id("ask"))!;
    ask.prompt = sections(String(ask.prompt),
      `Worktree result: {{${wt}}}\nSquash result: {{${id("squash")}}}`,
      "Correct helper configuration errors before answering; the failed helper step will be retried.");

    const edges: DraftEdge[] = [
      { from: START_NODE, to: wt },
      { from: wt, to: id("ask"), when: isValue(`${wt}.kind`, "error"), label: "helper error" },
      { from: wt, to: id("impl") },
      { from: id("impl"), to: id("gate"), when: isValue(`${id("impl")}.status`, "DONE"), label: "done" },
      { from: id("impl"), to: id("ask"), label: "question" },
      { from: id("ask"), to: wt, when: isValue(`${wt}.kind`, "error"), label: "retry worktree" },
      { from: id("ask"), to: id("squash"), when: isValue(`${id("squash")}.kind`, "error"), label: "retry squash" },
      { from: id("ask"), to: id("gate"), when: isValue(`${id("gate")}.kind`, "error"), label: "retry gate" },
      { from: id("ask"), to: id("impl") },
      { from: id("gate"), to: id("ask"), when: isValue(`${id("gate")}.kind`, "error"), label: "helper error" },
      { from: id("gate"), to: id("review-round"), when: isTrue(`${id("gate")}.ok`), label: "green" },
      { from: id("gate"), to: id("ask"), when: isTrue(`${id("gate")}.ok`), label: "review rounds spent" },
      { from: id("review-round"), to: id("lenses") },
      { from: id("gate"), to: id("red-round"), when: visitsBelow(id("red-round"), rounds + 1), label: "red" },
      { from: id("red-round"), to: id("gatefix") },
      { from: id("gate"), to: id("ask"), label: "red, rounds spent" },
      { from: id("gatefix"), to: id("gate"), when: isValue(`${id("gatefix")}.status`, "FIXED"), label: "fixed" },
      { from: id("gatefix"), to: id("ask"), label: "question" },
      { from: id("lenses"), to: id("critic"), fanOutOver: `${id("lenses")}.lenses` },
      { from: id("critic"), to: id("fix") },
      { from: id("fix"), to: id("squash"), when: isValue(`${id("fix")}.status`, "CLEAN"), label: "clean" },
      { from: id("fix"), to: id("ask"), when: isValue(`${id("fix")}.status`, "NEEDS_HUMAN"), label: "question" },
      { from: id("fix"), to: id("gate"), when: isValue(`${id("fix")}.status`, "FIXED"), label: "fixed" },
      { from: id("fix"), to: id("ask"), label: "rounds spent" },
      { from: id("squash"), to: id("ask"), when: isValue(`${id("squash")}.kind`, "error"), label: "helper error" },
      { from: id("squash"), to: END_NODE },
    ];

    return graphSchema.parse({
      id: `${graphId}-${p}`.slice(0, 48),
      name: `${track.key} · ${track.title}`.slice(0, 80),
      description: `Track ${track.key} of ${ticket} (group ${track.group}), compiled from the run spec. Embedded by ${graphId}.`,
      example: `Part of the ${ticket} run`,
      nodes,
      edges,
      maxSteps: 500,
      tags: tagsFor(ticket),
      workerVisibility: "hidden",
    });
  };

  /* ── a stack gate with its loop, shared by groups and the final review ── */
  /**
   * gate → (green) next; red → the stage's fixer → fold its fixups → gate.
   * Whatever the fixer cannot settle, a fold conflict, or a gate that stays
   * red goes to the stage's one approval, and its answer back to the fixer.
   * The fixer is the caller's: a group's handles pick conflicts too, the
   * final review's is the node that addressed the findings.
   */
  const stackGate = (
    prefix: string,
    label: string,
    apps: string[],
    level: string,
    next: string,
    fixer: { id: string; rounds: number },
    /** Main path for the final review, where folding follows every fix. */
    foldPath: "main" | "fallback",
  ) => {
    const gate = `${prefix}-gate`;
    const fold = `${prefix}-fold`;
    const ask = `${prefix}-ask`;
    const redRound = `${prefix}-red-round`;
    const nodes: Draft[] = [
      { id: redRound, label: `${label} · gate repair round`, kind: "note", path: "fallback", maxVisits: fixer.rounds },
      {
        id: gate,
        label: `${label} · gate`,
        kind: "command",
        command: gateCommand(stack, apps, level),
        failOnExit: false,
        timeoutMinutes: 90,
        maxVisits: 12,
        maxAttempts: 1,
        fields: [field("ok", "every gate step passed", "boolean"), helperKind()],
      },
      {
        id: fold,
        label: `${label} · fold fixups`,
        kind: "command",
        path: foldPath,
        command: `${H} autosquash ${shellQuote(stack)} {{preflight.base}}`,
        failOnExit: false,
        maxVisits: 14,
        maxAttempts: 1,
        fields: [field("ok", "", "boolean"), helperKind()],
      },
    ];
    const edges: DraftEdge[] = [
      { from: gate, to: ask, when: isValue(`${gate}.kind`, "error"), label: "helper error" },
      { from: gate, to: next, when: isTrue(`${gate}.ok`), label: "green" },
      { from: gate, to: redRound, when: visitsBelow(redRound, fixer.rounds), label: "red" },
      { from: redRound, to: fixer.id },
      { from: gate, to: ask, label: "red, rounds spent" },
      { from: fold, to: ask, when: isValue(`${fold}.kind`, "error"), label: "helper error" },
      { from: fold, to: gate, when: isTrue(`${fold}.ok`), label: "folded" },
      { from: fold, to: ask, label: "conflict" },
      { from: ask, to: gate, when: isValue(`${gate}.kind`, "error"), label: "retry gate" },
      { from: ask, to: fold, when: isValue(`${fold}.kind`, "error"), label: "retry fold" },
      { from: ask, to: fixer.id },
    ];
    return { entry: gate, gate, fold, ask, nodes, edges };
  };

  /** A fixer's working rules, shared by the group and final fixers. */
  const FIXUP_RULE = `Every fix belongs to the sub-task commit that owns the code: find it with \`git log --oneline --grep "<KEY>"\` and commit the fix with \`git commit --fixup=<that sha>\`. The graph folds the fixups into their layers next.`;

  /* ── the parent ── */
  const children: Graph[] = [];
  const plan: CompiledRun["plan"] = [];
  const nodes: Draft[] = [
    {
      id: "preflight",
      label: "Preflight",
      kind: "command",
      command: `${H} preflight ${shellQuote(ticket)}`,
      timeoutMinutes: 30,
      maxAttempts: 1,
      failOnExit: false,
      fields: [field("ok", "", "boolean"), helperKind(), ...["stack", "base"].map(name => ({ ...field(name), optional: true }))],
    },
  ];
  nodes.push({ id: "preflight-ask", label: "Preflight · needs you", kind: "human", path: "fallback", maxVisits: 6,
    prompt: "Preflight failed: {{preflight}}. Resolve the environment problem and answer to retry." });
  const edges: DraftEdge[] = [{ from: START_NODE, to: "preflight" },
    { from: "preflight", to: "preflight-ask", when: isValue("preflight.kind", "error"), label: "helper error" },
    { from: "preflight-ask", to: "preflight" }];
  nodes[0]!.maxVisits = 7;
  let previous = "preflight";

  for (const group of spec.groups) {
    const g = slug(group.letter);
    const groupTracks = tracks.filter((track) => track.group === group.letter);
    const fork = `${g}-fork`;
    const join = `${g}-join`;
    nodes.push({ id: fork, label: `Group ${group.letter} · ${groupTracks.length} track${groupTracks.length === 1 ? "" : "s"}`, kind: "note" });
    edges.push({ from: previous, to: fork });

    const groupLanes = lanes(chains(groupTracks), spec.maxParallel);
    plan.push({ group: group.letter, lanes: groupLanes.map((lane) => lane.flat().map((track) => track.key)) });
    for (const lane of groupLanes) {
      let from = fork;
      for (const chain of lane) {
        chain.forEach((track, index) => {
          // A chain's later track builds on the one before it; everything
          // else starts from the stack as the earlier groups left it.
          const base = index === 0 ? stack : trackDir(chain[index - 1]!.key);
          const child = compileTrack(track, base);
          children.push(child);
          const node = `trk-${slug(track.key)}`;
          nodes.push({ id: node, label: `${track.key} · ${track.title}`.slice(0, 80), kind: "subgraph", graphId: child.id });
          edges.push({ from, to: node });
          from = node;
        });
      }
      edges.push({ from, to: join });
    }
    nodes.push({ id: join, label: `Group ${group.letter} · all tracks done`, kind: "note" });

    const integrate = `${g}-int`;
    const fixer = `${g}-fix`;
    const fixRounds = 4;
    const picks = sequence
      .filter((key) => byKey.get(key)!.group === group.letter)
      .map((key) => {
        const head = headOf(trackDir(key));
        const layer = layerEnd.get(key);
        return layer ? `${head.slice(0, -1)}:${layer}"` : head;
      });
    const checkpoint = spec.checkpoints.afterGroups.includes(group.letter);
    const after = checkpoint ? `${g}-check` : `${g}-done`;
    const gate = stackGate(
      g,
      `Group ${group.letter}`,
      appsOf(groupTracks.map((track) => track.key)),
      "group",
      after,
      { id: fixer, rounds: fixRounds },
      "fallback",
    );
    const conflictRound = `${g}-conflict-round`;
    nodes.push(
      { id: conflictRound, label: `Group ${group.letter} · conflict round`, kind: "note", path: "fallback", maxVisits: fixRounds },
      {
        id: integrate,
        label: `Group ${group.letter} · integrate`,
        kind: "command",
        command: `${H} pick ${shellQuote(stack)} ${picks.join(" ")}`,
        failOnExit: false,
        maxVisits: 11,
        maxAttempts: 1,
        fields: [field("ok", "every commit is on the stack", "boolean"), helperKind()],
      },
      {
        // One fixer for the stack: a pick that stopped on a conflict and a
        // gate that went red are both "the stack is not right yet", in the
        // same worktree, and continuing one thread keeps what it learnt
        // about this group's commits.
        id: fixer,
        label: `Group ${group.letter} · fix stack`,
        path: "fallback",
        cwd: stack,
        ...model("implementer"),
        continueThread: fixer,
        maxVisits: 14,
        fields: [
          field("status", "RESOLVED: pick conflict resolved; FIXED: gate fixes committed", "enum", ["RESOLVED", "FIXED", "NEEDS_HUMAN"]),
          field("summary"),
          question("for NEEDS_HUMAN: one precise question"),
        ],
        prompt: sections(
          `Conflict repair round {{visits.${conflictRound}}} of ${fixRounds}; gate repair round {{visits.${g}-red-round}} of ${fixRounds}. You keep the stack of ticket ${ticket} green while group ${group.letter} is integrated. Your working directory is the stack worktree ${stack}.`,
          `The stack is linear: one commit per sub-task, bottom to top: ${sequence.map(describeTrack).join("; ")}.`,
          "Find out which of two situations you are in, then handle that one:",
          `1. A cherry-pick stopped on a conflict — \`git status\` says a cherry-pick is in progress. The pick result (JSON: the conflicting commit, its layer branch and files):\n{{${integrate}}}\nKeep the intent of both sides. Then \`git add\` the files and run \`git -c core.editor=true cherry-pick --continue\`; when the result names a layer, \`git branch -f <layer> HEAD\`. Keep the commit message. Return RESOLVED.`,
          `2. Otherwise the deterministic gate is red:\n{{${gate.gate}}}\n${FIXUP_RULE} Return FIXED.`,
          `Maintainer guidance, if any: {{${gate.ask}}}`,
          `- ${READABLE_CODE}\n- ${SANDBOX}`,
          "Return NEEDS_HUMAN with one precise question when the two intents truly conflict or a maintainer gate blocks the fix.",
        ),
      },
      ...gate.nodes,
      {
        id: gate.ask,
        label: `Group ${group.letter} · needs you`,
        kind: "human",
        path: "fallback",
        maxVisits: 6,
        prompt: `Group ${group.letter} needs you (conflict round {{visits.${conflictRound}}} of ${fixRounds}; gate repair round {{visits.${g}-red-round}} of ${fixRounds}): a pick conflict or a red gate the fixer could not settle, or folding the fixups stopped on a conflict.\n\nPick: {{${integrate}}}\nGate: {{${gate.gate}}}\nFold: {{${gate.fold}}}\nQuestion: {{${fixer}.question}}\n\nResolve it in ${stack} or answer with guidance; the fixer goes on with it.`,
      },
    );
    edges.push(
      { from: gate.ask, to: integrate, when: isValue(`${integrate}.kind`, "error"), label: "retry integrate" },
      { from: join, to: integrate },
      { from: integrate, to: gate.ask, when: isValue(`${integrate}.kind`, "error"), label: "helper error" },
      { from: integrate, to: gate.entry, when: isTrue(`${integrate}.ok`), label: "picked" },
      { from: integrate, to: conflictRound, when: visitsBelow(conflictRound, fixRounds), label: "conflict" },
      { from: conflictRound, to: fixer },
      { from: integrate, to: gate.ask, label: "conflict, rounds spent" },
      { from: fixer, to: integrate, when: isValue(`${fixer}.status`, "RESOLVED"), label: "resolved" },
      { from: fixer, to: gate.fold, when: isValue(`${fixer}.status`, "FIXED"), label: "fixed" },
      { from: fixer, to: gate.ask, label: "question" },
      ...gate.edges,
    );

    if (checkpoint) {
      nodes.push({
        id: after,
        label: `Group ${group.letter} · checkpoint`,
        kind: "human",
        prompt: `Group ${group.letter} is merged on ${stack} and its gate is green. Review it, then answer to go on (stop the run to change course).`,
      });
    } else {
      nodes.push({ id: after, label: `Group ${group.letter} · merged`, kind: "note" });
    }
    previous = after;
  }

  /* ── final review ── */
  // The node that addresses the findings is also the one that makes a red
  // final gate green: same worktree, same fixup rule, and continuing its own
  // thread it knows which of its fixes the gate is complaining about.
  const finalLenses = spec.finalReview.lenses;
  const afterFinal = spec.dryRun ? END_NODE : "layers";
  const finalRounds = 4;
  const finalGate = stackGate(
    "final",
    "Final",
    appsOf(sequence),
    "group",
    afterFinal,
    { id: "final-fix", rounds: finalRounds },
    "main",
  );
  nodes.push(
    {
      id: "final-lenses",
      label: `Final review (${finalLenses.length})`,
      kind: "command",
      command: listCommand("lenses", finalLenses),
      maxAttempts: 1,
      fields: [field("lenses", "", "list")],
    },
    {
      id: "final-critic",
      label: "Final critic",
      cwd: stack,
      ...model("critic"),
      prompt: sections(
        `Final review of ticket ${ticket} (${spec.title}): the whole stack, through one lens: {{item}}.`,
        COLLABORATION,
        `## The lenses (apply only yours)\n${finalLenses.map((lens) => `- ${lens}: ${LENSES[lens]}`).join("\n")}`,
        `## What to review\nYour working directory is the stack worktree ${stack}. The change is \`git diff {{preflight.base}}...HEAD\`; one commit per sub-task. Each sub-task was already reviewed alone, so look first at what only the whole shows: seams, duplicated logic, inconsistent naming or error handling, and acceptance criteria. Change nothing.`,
        `Parent ticket goal and acceptance criteria:\n${clip(spec.acceptance, ACCEPTANCE_CHARS)}`,
        `Sub-tasks: ${sequence.map(describeTrack).join("; ")}.`,
        "Name the owning sub-task key on every finding. Answer with a summary, then each finding as: [id] severity owner — file:line, problem, suggested fix.",
      ),
    },
    {
      id: "final-fix",
      label: "Final fixes",
      cwd: stack,
      ...model("implementer"),
      continueThread: "final-fix",
      maxVisits: 11,
      fields: [
        field("status", "CLEAN: nothing had to change; FIXED: fixes committed", "enum", ["CLEAN", "FIXED", "NEEDS_HUMAN"]),
        field("summary", "one response per finding id, or what you changed for the gate"),
        question("for NEEDS_HUMAN: one precise question"),
      ],
      prompt: sections(
        `Final gate repair round {{visits.final-red-round}} of ${finalRounds}. Address the final review of ticket ${ticket}. Your working directory is the stack worktree ${stack}.`,
        `Findings:\n{{final-critic}}`,
        `Verify each finding in the code first; decline the ones that are wrong, with the reason. ${FIXUP_RULE} A cross-cutting fix belongs to the top layer’s last sub-task (${sequence[sequence.length - 1]}): make a fixup of that commit too.`,
        `The final gate's result — empty until it has run; when it is not empty, the gate went red after your fixes and making it green is your task now:\n{{${finalGate.gate}}}`,
        `Maintainer guidance, if any: {{${finalGate.ask}}}`,
        `- ${READABLE_CODE}\n- ${SANDBOX}`,
        "Return CLEAN when nothing had to change, FIXED when you committed fixes, NEEDS_HUMAN with a question.",
      ),
    },
    ...finalGate.nodes,
    {
      id: finalGate.ask,
      label: "Final review · needs you",
      kind: "human",
      path: "fallback",
      maxVisits: 6,
      prompt: `The final review needs you (gate repair round {{visits.final-red-round}} of ${finalRounds}): a question from the fixer, a gate that stays red, or folding the fixups stopped on a conflict.\n\nQuestion: {{final-fix.question}}\nSummary: {{final-fix.summary}}\nGate: {{${finalGate.gate}}}\nFold: {{${finalGate.fold}}}\n\nResolve it in ${stack} or answer with guidance; the fixer goes on with it.`,
    },
  );
  edges.push(
    { from: previous, to: "final-lenses" },
    { from: "final-lenses", to: "final-critic", fanOutOver: "final-lenses.lenses" },
    { from: "final-critic", to: "final-fix" },
    // CLEAN still passes the gate: a fixer sent back by a red gate that
    // answers CLEAN must not walk the stack past it.
    { from: "final-fix", to: finalGate.gate, when: isValue("final-fix.status", "CLEAN"), label: "clean" },
    { from: "final-fix", to: finalGate.fold, when: isValue("final-fix.status", "FIXED"), label: "fixed" },
    { from: "final-fix", to: finalGate.ask, label: "question" },
    ...finalGate.edges,
  );

  /* ── layer gates and submit ── */
  if (!spec.dryRun) {
    const layerGates = spec.layers
      .flatMap((layer) =>
        appsOf(layer.tracks).map(
          (app) => `${H} gate-layer ${shellQuote(stack)} ${shellQuote(app)} ${shellQuote(layer.branch)}`,
        ),
      )
      .join(" && ");
    nodes.push(
      {
        id: "layers",
        label: `Layer gates (${spec.layers.length})`,
        kind: "command",
        command: `extra=$(git -C ${shellQuote(stack)} rev-list ${shellQuote(`${spec.layers[spec.layers.length - 1]!.branch}..HEAD`)}) || { printf '%s\\n' '{"ok":false,"kind":"error","error":"Cannot inspect the top layer"}'; exit 2; }; if [ -n "$extra" ]; then printf '%s\\n' '{"ok":false,"error":"Commits above the top layer would be omitted from the PRs; fold them into the owning layer"}'; exit 1; fi; ${layerGates}`,
        failOnExit: false,
        timeoutMinutes: 240,
        maxVisits: 5,
        maxAttempts: 1,
        fields: [field("ok", "", "boolean"), helperKind()],
      },
      {
        id: "layers-ask",
        label: "Layer gate · needs you",
        kind: "human",
        path: "fallback",
        maxVisits: 4,
        prompt: `A layer gate is red:\n\n{{layers}}\n\nFix it in ${stack} (a fixup into the owning layer, then \`${helper} autosquash ${stack} <base>\`) and answer to run the layer gates again.`,
      },
      {
        id: "submit",
        failOnExit: false,
        fields: [field("ok", "", "boolean"), helperKind()],
        label: "Submit stacked PRs",
        kind: "command",
        command: `${H} submit ${shellQuote(stack)} ${spec.layers.map((layer) => shellQuote(layer.branch)).join(" ")}`,
        timeoutMinutes: 30,
        maxAttempts: 1,
      },
    );
    edges.push(
      { from: "layers", to: "layers-ask", when: isValue("layers.kind", "error"), label: "helper error" },
      { from: "layers", to: "submit", when: isTrue("layers.ok"), label: "green" },
      { from: "layers", to: "layers-ask", label: "red" },
      { from: "layers-ask", to: "layers", when: isValue("layers.kind", "error"), label: "retry layer gates" },
      { from: "layers-ask", to: "layers", when: isValue("submit.kind", "error"), label: "retry submit preparation" },
      { from: "layers-ask", to: "layers" },
      { from: "submit", to: "layers-ask", when: isValue("submit.kind", "error"), label: "helper error" },
      { from: "submit", to: END_NODE },
    );
  }

  const graph = graphSchema.parse({
    id: graphId,
    name: `${ticket} · ${spec.title}`.slice(0, 80),
    description: `Compiled from the ${ticket} run spec: ${spec.groups.length} groups, ${tracks.length} tracks in up to ${spec.maxParallel} lanes, ${spec.layers.length} PR layers${spec.dryRun ? ", dry run (no submit)" : ""}. Each track is an embedded graph.`.slice(0, 500),
    example: `Develop ${ticket}`,
    nodes,
    edges,
    maxSteps: 500,
    maxFanOut: 8,
    tags: tagsFor(ticket),
    workerVisibility: "hidden",
  });
  for (const compiled of [graph, ...children]) {
    for (const node of compiled.nodes) {
      if (node.kind !== "command" || !(node.id === "preflight" || node.id === "submit" || node.id.endsWith("-wt") || node.id.endsWith("-squash"))) continue;
      // These steps used to stop on any non-zero exit. Only a classified
      // environment error may now survive long enough to reach a human.
      node.failOnExit = true;
      node.command = `result=$(${node.command}); code=$?; printf '%s\\n' "$result"; if [ "$code" -ne 0 ] && [ "$(printf '%s\\n' "$result" | tail -n 1 | jq -r '.kind // empty' 2>/dev/null)" != error ]; then exit "$code"; fi`;
    }
  }
  return { ok: true, run: { graph, children, plan } };
}
