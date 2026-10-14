// A compiled task-dev run, end to end, on a real repository: the demo spec is
// compiled, the demo repository is set up by its own script, every command
// node runs the demo helper for real (git worktrees, squash, cherry-pick,
// autosquash), and only the agents are scripted. If the compiler wires a path,
// a placeholder or a join wrongly, this is where it shows — the unit tests
// only see the drawing.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, MemorySaver } from "@langchain/langgraph";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyRunState, type Graph } from "../lib/graph";
import { compileGraph, type RuntimeHost } from "../lib/runtime";
import { resolveIn, runShell } from "../lib/shell";
import { compileRunSpec } from "../lib/task-dev";

const demoDir = fileURLToPath(new URL("./fixtures/task-dev/demo/", import.meta.url));

let root = "";
let repo = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "gs-task-dev-"));
  repo = join(root, "repo");
  execFileSync("bash", [join(demoDir, "setup.sh"), repo]);
  // A fixed identity, so the test does not depend on the machine's git config.
  execFileSync("git", ["-C", repo, "config", "user.email", "demo@example.com"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Demo"]);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function commitFile(cwd: string, file: string, text: string, message: string) {
  writeFileSync(join(cwd, file), text);
  if (file.endsWith(".sh")) chmodSync(join(cwd, file), 0o755);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
}

const json = (value: unknown) => `Done.\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

/**
 * The scripted agents, by the node that is speaking — which, in a continued
 * thread, is the node that last sent into it, not the one that spawned it.
 *
 * DEMO-3's implementer forgets the "# Usage:" line the gate demands, so that
 * track goes through the gate-fix loop. DEMO-2's first findings fix commits a
 * change, so its critics review a second round. Implementers that are done
 * leave the optional `question` out, as a real worker would.
 */
function agentFor(nodeId: string, cwd: string, call: number): string {
  switch (nodeId) {
    case "demo-2-impl":
      commitFile(cwd, "greet.sh", '#!/usr/bin/env bash\n# Usage: greet.sh [name]\necho "Hello, ${1:-world}!"\n', "greet");
      return json({ status: "DONE", summary: "greet.sh" });
    case "demo-3-impl":
      commitFile(cwd, "count.sh", '#!/usr/bin/env bash\nwc -l < "$1"\n', "count");
      return json({ status: "DONE", summary: "count.sh" });
    case "demo-3-gatefix": {
      const text = readFileSync(join(cwd, "count.sh"), "utf8").replace("\n", "\n# Usage: count.sh <file>\n");
      commitFile(cwd, "count.sh", text, "count: usage line");
      return json({ status: "FIXED", summary: "added the usage line" });
    }
    case "demo-2-fix":
      if (call === 1) {
        const text = readFileSync(join(cwd, "greet.sh"), "utf8").replace("echo", "# Greets.\necho");
        commitFile(cwd, "greet.sh", text, "greet: comment");
        return json({ status: "FIXED", summary: "[1] fixed" });
      }
      return json({ status: "CLEAN", summary: "nothing left" });
    case "demo-4-impl":
      commitFile(cwd, "README.md", `${readFileSync(join(cwd, "README.md"), "utf8")}\n## Tools\n\n- greet.sh\n- count.sh\n`, "docs");
      return json({ status: "DONE", summary: "README" });
    default:
      if (nodeId.endsWith("critic")) return "No findings. The change does what the spec asks.";
      if (nodeId.endsWith("fix")) return json({ status: "CLEAN", summary: "nothing to fix", question: "" });
      throw new Error(`no script for ${nodeId}`);
  }
}

/** The lens a critic prompt is about, so per-lens threads can be told apart. */
const lensOf = (prompt: string) => /through one lens: ([a-z-]+)\./.exec(prompt)?.[1] ?? "";

type Spawn = { nodeId: string; threadId: string; visibility: string | undefined; lens: string };
type Send = { threadId: string; nodeId: string; lens: string };

function demoHost() {
  const spawned: Spawn[] = [];
  const sent: Send[] = [];
  const commands: string[] = [];
  const failures: string[] = [];
  /** Per thread: its working directory and the node now speaking in it. */
  const threads = new Map<string, { cwd: string; nodeId: string; lens: string }>();
  const calls = new Map<string, number>();
  const host: RuntimeHost = {
    async spawn({ nodeId, cwd, visibility, prompt }) {
      const threadId = `thr_${spawned.length + 1}`;
      spawned.push({ nodeId, threadId, visibility, lens: lensOf(prompt) });
      threads.set(threadId, { cwd: resolveIn(repo, cwd), nodeId, lens: lensOf(prompt) });
      return threadId;
    },
    async sendMessage(threadId, text) {
      const thread = threads.get(threadId);
      if (!thread) throw new Error(`send into unknown thread ${threadId}`);
      // The speaker is only known once the runtime names the attempt's
      // thread (onNodeThread, right after this); the lens is in the text.
      sent.push({ threadId, nodeId: "", lens: lensOf(text) });
    },
    async awaitThread(threadId) {
      const thread = threads.get(threadId)!;
      const call = (calls.get(thread.nodeId) ?? 0) + 1;
      calls.set(thread.nodeId, call);
      return agentFor(thread.nodeId, thread.cwd, call);
    },
    async runCommand({ nodeId, command, cwd, timeoutMs }) {
      commands.push(nodeId);
      return runShell({ command, cwd: resolveIn(repo, cwd), timeoutMs });
    },
    async loadDialog() {
      return null;
    },
    async saveDialog() {},
    async onNodeStart(nodeId) {
      return nodeId;
    },
    async onNodeThread(nodeId, threadId) {
      const thread = threads.get(threadId)!;
      thread.nodeId = nodeId;
      // Parallel critics send before either names its thread, so the send is
      // found by thread, not by order.
      const open = sent.find((entry) => entry.threadId === threadId && entry.nodeId === "");
      if (open) open.nodeId = nodeId;
    },
    async onNodeFinish(nodeId, patch) {
      if (patch.status === "failed") failures.push(`${nodeId}: ${patch.error}`);
    },
    async onStateChange() {},
    log() {},
    async wait() {},
  };
  return { host, spawned, sent, commands, failures };
}

describe("a compiled demo run on a real repository", () => {
  it("builds the stack track by track, pauses at the checkpoint, and submits", async () => {
    process.env.FAKE_DELAY = "0";
    const spec = JSON.parse(readFileSync(join(repo, "demo.run-spec.json"), "utf8"));
    // This scenario deliberately fixes and re-reviews DEMO-2; request two
    // review rounds rather than relying on the old off-by-one allowance.
    spec.groups[0].tracks[0].maxRounds = 2;
    const result = compileRunSpec(spec);
    if (!result.ok) throw new Error(result.errors.join("\n"));
    const graphs = new Map<string, Graph>(
      [result.run.graph, ...result.run.children].map((graph) => [graph.id, graph]),
    );
    const { host, spawned, sent, commands, failures } = demoHost();
    const app = compileGraph(result.run.graph, host, new MemorySaver(), (id) => graphs.get(id) ?? null);
    const config = { configurable: { thread_id: "demo" }, recursionLimit: 500 };

    await app.invoke(emptyRunState("Develop DEMO-1"), config);
    expect(failures).toEqual([]);
    // Group A is merged and gated; the checkpoint holds group B back.
    const pending = (await app.getState(config)).tasks.flatMap((task) => task.interrupts ?? []);
    expect(pending.map((entry) => (entry.value as { label: string }).label)).toEqual(["Group A · checkpoint"]);
    expect(spawned.map((entry) => entry.nodeId)).not.toContain("demo-4-impl");
    // DEMO-3 went through the gate-fix loop, DEMO-2 did not — and the gate
    // fix was sent into the implementer's thread instead of spawning one.
    const spawnOf = (nodeId: string, lens = "") =>
      spawned.find((entry) => entry.nodeId === nodeId && entry.lens === lens)!.threadId;
    expect(sent).toContainEqual({ threadId: spawnOf("demo-3-impl"), nodeId: "demo-3-gatefix", lens: "" });
    expect(sent.map((entry) => entry.nodeId)).not.toContain("demo-2-gatefix");

    const done = await app.invoke(new Command({ resume: "go on" }), config);
    expect(failures).toEqual([]);
    expect(done.fields["demo-4-squash"]?.sha).toMatch(/^[0-9a-f]{40}$/);

    // One worker per implementer, per critic lens and for the final review —
    // the rest continued a thread. Measured before continuing existed: 14
    // spawns on this script without a second review round.
    expect(spawned.map((entry) => `${entry.nodeId}${entry.lens ? `#${entry.lens}` : ""}`).sort()).toEqual([
      "demo-2-critic#correctness",
      "demo-2-critic#spec-tests",
      "demo-2-impl",
      "demo-3-critic#correctness",
      "demo-3-impl",
      "demo-4-critic#spec-tests",
      "demo-4-impl",
      "final-critic#acceptance",
      "final-critic#correctness",
      "final-fix",
    ]);
    // DEMO-2's findings were fixed twice, both times in the implementer's
    // thread; its critics reviewed the second round in their own threads.
    expect(sent.filter((entry) => entry.nodeId === "demo-2-fix")).toEqual([
      { threadId: spawnOf("demo-2-impl"), nodeId: "demo-2-fix", lens: "" },
      { threadId: spawnOf("demo-2-impl"), nodeId: "demo-2-fix", lens: "" },
    ]);
    expect(sent.filter((entry) => entry.nodeId === "demo-2-critic").sort((a, b) => a.lens.localeCompare(b.lens))).toEqual([
      { threadId: spawnOf("demo-2-critic", "correctness"), nodeId: "demo-2-critic", lens: "correctness" },
      { threadId: spawnOf("demo-2-critic", "spec-tests"), nodeId: "demo-2-critic", lens: "spec-tests" },
    ]);
    expect(sent).toHaveLength(7);
    // Generated graphs spawn hidden workers.
    expect(new Set(spawned.map((entry) => entry.visibility))).toEqual(new Set(["hidden"]));

    const stack = join(repo, ".worktrees/demo-1/_stack");
    const subjects = git(stack, "log", "--format=%s", "main..HEAD").split("\n");
    expect(subjects).toEqual([
      "feat(tools): DEMO-4 Document the tools",
      "feat(tools): DEMO-3 count.sh",
      "feat(tools): DEMO-2 greet.sh",
    ]);
    // Every layer branch points at the last commit of its layer.
    expect(git(repo, "rev-parse", "demo-1/b1-docs")).toBe(git(stack, "rev-parse", "HEAD"));
    expect(git(repo, "log", "-1", "--format=%s", "demo-1/a1-greet")).toBe("feat(tools): DEMO-2 greet.sh");
    // The second review round's fix is in DEMO-2's squashed commit.
    expect(git(stack, "show", "demo-1/a1-greet:greet.sh")).toContain("# Greets.");
    expect(commands).toContain("layers");
    expect(commands.at(-1)).toBe("submit");
  }, 60_000);
});
