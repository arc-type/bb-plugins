// `continueThread`: a node sends its prompt into a worker thread that already
// exists instead of spawning a fresh one. What has to hold: it continues
// exactly the thread the author named (per fan-out entry where it runs fanned
// out), it spawns as before when there is nothing to continue, the thread ids
// live in the checkpointed state, and the validator refuses every target that
// would send a message into the wrong conversation.
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { emptyRunState, graphSchema, validateGraph, type Graph } from "../lib/graph";
import { compileGraph, type RuntimeHost } from "../lib/runtime";

/**
 * A host whose threads remember who is speaking in them: the node that
 * spawned the thread, then whichever node the runtime last attached to it.
 */
function threadHost(replies: Record<string, string[]>) {
  const spawned: Array<{ nodeId: string; threadId: string; visibility?: string }> = [];
  const sent: Array<{ threadId: string; text: string }> = [];
  const attached: Array<{ nodeId: string; threadId: string }> = [];
  const speaker = new Map<string, string>();
  const calls = new Map<string, number>();
  const host: RuntimeHost = {
    async spawn({ nodeId, visibility }) {
      const threadId = `thr_${spawned.length + 1}`;
      spawned.push({ nodeId, threadId, visibility });
      speaker.set(threadId, nodeId);
      return threadId;
    },
    async sendMessage(threadId, text) {
      sent.push({ threadId, text });
    },
    async awaitThread(threadId) {
      const nodeId = speaker.get(threadId)!;
      const call = calls.get(nodeId) ?? 0;
      calls.set(nodeId, call + 1);
      const script = replies[nodeId] ?? [`output of ${nodeId}`];
      return script[Math.min(call, script.length - 1)]!;
    },
    async loadDialog() {
      return null;
    },
    async saveDialog() {},
    async onNodeStart(nodeId) {
      return nodeId;
    },
    async onNodeThread(nodeId, threadId) {
      attached.push({ nodeId, threadId });
      speaker.set(threadId, nodeId);
    },
    async onNodeFinish() {},
    async onStateChange() {},
    log() {},
    async wait() {},
  };
  return { host, spawned, sent, attached };
}

const config = (id: string) => ({ configurable: { thread_id: id }, recursionLimit: 100 });

/** implement → review → fix, with fix optionally continuing implement. */
function chain(fix: Record<string, unknown>): Graph {
  return graphSchema.parse({
    id: "chain",
    name: "Chain",
    nodes: [
      { id: "impl", label: "Implement", prompt: "Build it." },
      { id: "review", label: "Review", prompt: "Review {{impl}}." },
      { id: "fix", label: "Fix", prompt: "Fix {{review}}.", ...fix },
    ],
    edges: [
      { from: "__start__", to: "impl" },
      { from: "impl", to: "review" },
      { from: "review", to: "fix" },
      { from: "fix", to: "__end__" },
    ],
  });
}

describe("continuing a thread at run time", () => {
  it("spawns a fresh worker per node when nothing asks to continue", async () => {
    const { host, spawned, sent } = threadHost({});
    await compileGraph(chain({}), host).invoke(emptyRunState("t"));
    expect(spawned.map((entry) => entry.nodeId)).toEqual(["impl", "review", "fix"]);
    expect(sent).toEqual([]);
  });

  it("sends the fix into the implementer's thread instead of spawning", async () => {
    const { host, spawned, sent, attached } = threadHost({});
    const result = await compileGraph(chain({ continueThread: "impl" }), host).invoke(emptyRunState("t"));
    expect(spawned.map((entry) => entry.nodeId)).toEqual(["impl", "review"]);
    const implThread = spawned[0]!.threadId;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.threadId).toBe(implThread);
    // The full composed prompt goes in: a continued step still needs its task.
    expect(sent[0]!.text).toContain("Fix output of review.");
    // The attempt names the thread it used, so the inspector links to it.
    expect(attached).toContainEqual({ nodeId: "fix", threadId: implThread });
    expect(result.outputs.fix).toBe("output of fix");
    expect(result.threads).toEqual({ impl: implThread, review: spawned[1]!.threadId });
  });

  it("spawns when the thread to continue does not exist yet, and keeps it for later", async () => {
    const graph = graphSchema.parse({
      id: "early",
      name: "Early",
      nodes: [
        { id: "fix", label: "Fix", prompt: "x", continueThread: "impl" },
        { id: "impl", label: "Implement", prompt: "y" },
      ],
      edges: [
        { from: "__start__", to: "fix" },
        { from: "fix", to: "impl" },
        { from: "impl", to: "__end__" },
      ],
    });
    const { host, spawned, sent } = threadHost({});
    const result = await compileGraph(graph, host).invoke(emptyRunState("t"));
    // `impl` itself does not continue anything, so it spawns its own.
    expect(spawned.map((entry) => entry.nodeId)).toEqual(["fix", "impl"]);
    expect(sent).toEqual([]);
    expect(result.threads.impl).toBe(spawned[1]!.threadId);
  });

  it("continues its own thread on the next visit of a loop", async () => {
    const graph = graphSchema.parse({
      id: "loop",
      name: "Loop",
      nodes: [
        {
          id: "work",
          label: "Work",
          prompt: "again",
          maxVisits: 3,
          continueThread: "work",
          fields: [{ name: "done", type: "boolean" }],
        },
      ],
      edges: [
        { from: "__start__", to: "work" },
        { from: "work", to: "__end__", when: { source: "field", key: "done", op: "equals", value: "true" } },
        { from: "work", to: "work" },
      ],
    });
    const { host, spawned, sent } = threadHost({
      work: ['```json\n{"done": false}\n```', '```json\n{"done": false}\n```', '```json\n{"done": true}\n```'],
    });
    await compileGraph(graph, host).invoke(emptyRunState("t"));
    expect(spawned.map((entry) => entry.nodeId)).toEqual(["work"]);
    expect(sent.map((entry) => entry.threadId)).toEqual([spawned[0]!.threadId, spawned[0]!.threadId]);
  });

  it("keeps one thread per fan-out entry and continues each in the next round", async () => {
    const graph = graphSchema.parse({
      id: "rounds",
      name: "Rounds",
      nodes: [
        { id: "lenses", label: "Lenses", prompt: "x", maxVisits: 2, fields: [{ name: "lenses", type: "list" }] },
        { id: "critic", label: "Critic", prompt: "Lens {{item}}.", maxVisits: 4, continueThread: "critic" },
        { id: "gate", label: "Gate", prompt: "x", maxVisits: 2 },
      ],
      edges: [
        { from: "__start__", to: "lenses" },
        { from: "lenses", to: "critic", fanOutOver: "lenses.lenses" },
        { from: "critic", to: "gate" },
        { from: "gate", to: "lenses", when: { source: "output", key: "gate", op: "visitsBelow", value: "2" } },
        { from: "gate", to: "__end__" },
      ],
    });
    const { host, spawned, sent } = threadHost({ lenses: ['```json\n{"lenses": ["a", "b"]}\n```'] });
    const app = compileGraph(graph, host, new MemorySaver());
    await app.invoke(emptyRunState("t"), config("rounds"));
    const critics = spawned.filter((entry) => entry.nodeId === "critic");
    expect(critics).toHaveLength(2);
    // Round two went into the same two threads, each lens into its own.
    const byLens = (lens: string) => sent.find((entry) => entry.text.includes(`Lens ${lens}.`))!.threadId;
    const threads = (await app.getState(config("rounds"))).values.threads as Record<string, string>;
    expect(byLens("a")).toBe(threads["critic#a"]);
    expect(byLens("b")).toBe(threads["critic#b"]);
    expect(byLens("a")).not.toBe(byLens("b"));
    expect(new Set(critics.map((entry) => entry.threadId))).toEqual(new Set([threads["critic#a"], threads["critic#b"]]));
  });

  it("retries a broken answer in the same continued thread", async () => {
    const graph = chain({
      continueThread: "impl",
      maxAttempts: 2,
      fields: [{ name: "status", type: "enum", options: ["FIXED"] }],
    });
    const { host, spawned, sent } = threadHost({ fix: ["no json here", '```json\n{"status": "FIXED"}\n```'] });
    const result = await compileGraph(graph, host).invoke(emptyRunState("t"));
    expect(result.fields.fix).toEqual({ status: "FIXED" });
    expect(spawned.map((entry) => entry.nodeId)).toEqual(["impl", "review"]);
    expect(sent.map((entry) => entry.threadId)).toEqual([spawned[0]!.threadId, spawned[0]!.threadId]);
  });

  it("continues the thread a checkpoint recorded, after a resume", async () => {
    const graph = graphSchema.parse({
      id: "pause",
      name: "Pause",
      nodes: [
        { id: "impl", label: "Implement", prompt: "x" },
        { id: "ok", label: "OK?", kind: "human" },
        { id: "fix", label: "Fix", prompt: "y", continueThread: "impl" },
      ],
      edges: [
        { from: "__start__", to: "impl" },
        { from: "impl", to: "ok" },
        { from: "ok", to: "fix" },
        { from: "fix", to: "__end__" },
      ],
    });
    const saver = new MemorySaver();
    const first = threadHost({});
    await compileGraph(graph, first.host, saver).invoke(emptyRunState("t"), config("pause"));
    // A new driver with a host that has never seen the thread: only the
    // checkpoint can tell it which thread to continue.
    const second = threadHost({});
    const { Command } = await import("@langchain/langgraph");
    await compileGraph(graph, second.host, saver).invoke(new Command({ resume: "yes" }), config("pause"));
    expect(second.spawned).toEqual([]);
    expect(second.sent.map((entry) => entry.threadId)).toEqual([first.spawned[0]!.threadId]);
  });

  it("files a dialogue's thread under its own id, so an agent can continue the interview", async () => {
    const graph = graphSchema.parse({
      id: "talk",
      name: "Talk",
      nodes: [
        // The field means nothing on a dialogue (the validator warns); it must
        // not file the thread under a node that never had it.
        { id: "talk", label: "Talk", kind: "dialog", prompt: "x", continueThread: "other" },
        { id: "build", label: "Build", prompt: "y", continueThread: "talk" },
      ],
      edges: [
        { from: "__start__", to: "talk" },
        { from: "talk", to: "build" },
        { from: "build", to: "__end__" },
      ],
    });
    const { host, spawned, sent } = threadHost({ talk: ['Agreed.\n```json\n{"done": true}\n```'] });
    const result = await compileGraph(graph, host).invoke(emptyRunState("t"));
    expect(spawned.map((entry) => entry.nodeId)).toEqual(["talk"]);
    expect(result.threads).toEqual({ talk: spawned[0]!.threadId });
    expect(sent.map((entry) => entry.threadId)).toEqual([spawned[0]!.threadId]);
  });

  it("spawns workers with the graph's visibility, visible unless it says hidden", async () => {
    const visible = threadHost({});
    await compileGraph(chain({}), visible.host).invoke(emptyRunState("t"));
    expect(new Set(visible.spawned.map((entry) => entry.visibility))).toEqual(new Set(["visible"]));
    const hidden = threadHost({});
    await compileGraph({ ...chain({}), workerVisibility: "hidden" }, hidden.host).invoke(emptyRunState("t"));
    expect(new Set(hidden.spawned.map((entry) => entry.visibility))).toEqual(new Set(["hidden"]));
  });
});

describe("validating continueThread", () => {
  const graph = (nodes: unknown[], edges: unknown[] = []) =>
    graphSchema.parse({
      id: "v",
      name: "V",
      nodes,
      edges: [
        { from: "__start__", to: (nodes[0] as { id: string }).id },
        ...nodes.slice(1).map((node, index) => ({
          from: (nodes[index] as { id: string }).id,
          to: (node as { id: string }).id,
        })),
        { from: (nodes.at(-1) as { id: string }).id, to: "__end__" },
        ...edges,
      ],
    });
  const findings = (value: Graph) =>
    validateGraph(value).filter((problem) => /thread/.test(problem.message));

  it("accepts its own id, and another agent or dialogue node", () => {
    expect(findings(graph([{ id: "a", label: "A", prompt: "x", continueThread: "a" }]))).toEqual([]);
    expect(
      findings(graph([{ id: "a", label: "A", prompt: "x" }, { id: "b", label: "B", prompt: "x", continueThread: "a" }])),
    ).toEqual([]);
    expect(
      findings(
        graph([
          { id: "a", label: "A", kind: "dialog", prompt: "x" },
          { id: "b", label: "B", prompt: "x", continueThread: "a" },
        ]),
      ),
    ).toEqual([]);
  });

  it("refuses an unknown node", () => {
    const problems = findings(graph([{ id: "b", label: "B", prompt: "x", continueThread: "ghost" }]));
    expect(problems).toEqual([
      { level: "error", message: '"B" continues the thread of "ghost", which is no node in this graph.' },
    ]);
  });

  it("refuses a command, an approval or a note as the thread", () => {
    for (const kind of ["command", "human", "note"]) {
      const problems = findings(
        graph([
          { id: "a", label: "A", kind, prompt: "x", command: "true" },
          { id: "b", label: "B", prompt: "x", continueThread: "a" },
        ]),
      );
      expect(problems.map((problem) => problem.level)).toEqual(["error"]);
      expect(problems[0]!.message).toMatch(/has no worker thread/);
    }
  });

  it("refuses continuing a node that runs fanned out, from anywhere else", () => {
    const value = graphSchema.parse({
      id: "fan",
      name: "Fan",
      nodes: [
        { id: "list", label: "List", prompt: "x", fields: [{ name: "items", type: "list" }] },
        { id: "each", label: "Each", prompt: "{{item}}", continueThread: "each" },
        { id: "after", label: "After", prompt: "x", continueThread: "each" },
      ],
      edges: [
        { from: "__start__", to: "list" },
        { from: "list", to: "each", fanOutOver: "list.items" },
        { from: "each", to: "after" },
        { from: "after", to: "__end__" },
      ],
    });
    const problems = findings(value);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toMatch(/"After" continues the thread of "Each", which runs once per fan-out entry/);
  });

  it("refuses a fanned-out node continuing another node's thread", () => {
    const value = graphSchema.parse({
      id: "fan",
      name: "Fan",
      nodes: [
        { id: "list", label: "List", prompt: "x", fields: [{ name: "items", type: "list" }] },
        { id: "each", label: "Each", prompt: "{{item}}", continueThread: "list" },
      ],
      edges: [
        { from: "__start__", to: "list" },
        { from: "list", to: "each", fanOutOver: "list.items" },
        { from: "each", to: "__end__" },
      ],
    });
    expect(findings(value).map((problem) => problem.message)).toEqual([
      '"Each" runs once per fan-out entry and would send every entry into the one thread of "List"; a fanned-out node may only continue its own thread.',
    ]);
  });

  it("warns when the field sits on a node that is not an agent", () => {
    const problems = findings(graph([{ id: "a", label: "A", kind: "human", prompt: "x", continueThread: "a" }]));
    expect(problems).toEqual([
      { level: "warning", message: '"A" is a Approval node; only agent nodes continue a thread, so "a" goes unused.' },
    ]);
  });

  it("warns when the continuing node names another model or working directory", () => {
    const model = { providerId: "p", model: "m" };
    const same = graph([
      { id: "a", label: "A", prompt: "x", cwd: "w", ...model },
      { id: "b", label: "B", prompt: "x", continueThread: "a", cwd: "w", ...model },
    ]);
    expect(findings(same)).toEqual([]);
    const otherModel = graph([
      { id: "a", label: "A", prompt: "x", ...model },
      { id: "b", label: "B", prompt: "x", continueThread: "a" },
    ]);
    expect(findings(otherModel).map((problem) => [problem.level, problem.message])).toEqual([
      ["warning", '"B" continues the thread of "A" but names a different model; a continued thread keeps the one it was started with.'],
    ]);
    const otherCwd = graph([
      { id: "a", label: "A", prompt: "x", cwd: "w" },
      { id: "b", label: "B", prompt: "x", continueThread: "a", cwd: "v" },
    ]);
    expect(findings(otherCwd)[0]!.message).toMatch(/different working directory/);
  });
});
