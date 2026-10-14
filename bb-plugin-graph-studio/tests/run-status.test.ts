// What each node of a run shows. The nodes without attempt rows — approvals,
// notes, subgraphs — are where the canvas used to lie: a track busy inside
// stayed grey, an answered checkpoint went back to looking unanswered. Every
// rule gets the case where it must fire and the case where it must not.
import { describe, expect, it } from "vitest";
import { emptyRunState, graphSchema, type Graph, type RunState } from "../lib/graph";
import {
  reachedNodes,
  runResolver,
  runStatuses,
  unreachedFallbacks,
  type StatusRun,
} from "../lib/run-status";

const child = graphSchema.parse({
  id: "track",
  name: "Track",
  nodes: [
    { id: "impl", label: "T-1 · implement", prompt: "x" },
    { id: "ask", label: "T-1 · needs you", kind: "human", path: "fallback" },
    { id: "squash", label: "T-1 · squash", kind: "command", command: "true" },
  ],
  edges: [
    { from: "__start__", to: "impl" },
    { from: "impl", to: "ask", when: { source: "output", key: "impl", op: "contains", value: "?" } },
    { from: "impl", to: "squash" },
    { from: "ask", to: "impl" },
    { from: "squash", to: "__end__" },
  ],
});

const parent = graphSchema.parse({
  id: "parent",
  name: "Parent",
  nodes: [
    { id: "fork", label: "Fork", kind: "note" },
    { id: "trk", label: "T-1 · the track", kind: "subgraph", graphId: "track" },
    { id: "check", label: "Checkpoint", kind: "human" },
    { id: "after", label: "After", prompt: "x" },
  ],
  edges: [
    { from: "__start__", to: "fork" },
    { from: "fork", to: "trk" },
    { from: "trk", to: "check" },
    { from: "check", to: "after" },
    { from: "after", to: "__end__" },
  ],
});

type Row = StatusRun["nodeRuns"][number];

function run(over: Partial<Omit<StatusRun, "state">> & { state?: Partial<RunState> } = {}): StatusRun {
  return {
    graph: parent,
    status: "running",
    nodeRuns: [],
    pendingQuestion: null,
    embedded: [child],
    ...over,
    state: { ...emptyRunState("task"), ...over.state },
  };
}

const statusesOf = (value: StatusRun) => runStatuses(value, runResolver(value)).statuses;
const textsOf = (value: StatusRun) => runStatuses(value, runResolver(value)).texts;
const row = (nodeId: string, status: Row["status"], endedAt: number | null = null): Row => ({
  nodeId,
  status,
  endedAt,
});

describe("nodes without attempt rows", () => {
  it("shows an answered approval as done, and an unanswered one as idle", () => {
    const answered = run({ state: { visits: { check: 1 }, outputs: { check: "go on" } } });
    expect(statusesOf(answered).check).toBe("done");
    expect(statusesOf(run()).check).toBeUndefined();
  });

  it("shows the approval the run waits on as waiting, also on a second visit", () => {
    const asked = run({ pendingQuestion: { nodeId: "check" }, status: "waiting-human" });
    expect(statusesOf(asked).check).toBe("waiting");
    const again = run({
      pendingQuestion: { nodeId: "check" },
      status: "waiting-human",
      state: { visits: { check: 1 }, outputs: { check: "first answer" } },
    });
    expect(statusesOf(again).check).toBe("waiting");
  });

  it("shows a note the run passed as done, one it did not as idle", () => {
    expect(statusesOf(run({ state: { visits: { fork: 1 } } })).fork).toBe("done");
    expect(statusesOf(run()).fork).toBeUndefined();
  });

  it("still takes the latest attempt row for a worker node", () => {
    const value = run({ nodeRuns: [row("after", "failed"), row("after", "running")] });
    expect(statusesOf(value).after).toBe("running");
    expect(statusesOf(run({ nodeRuns: [row("after", "running"), row("after", "failed")] })).after).toBe("failed");
  });
});

describe("a subgraph node", () => {
  it("stays idle while nothing inside has run", () => {
    expect(statusesOf(run({ state: { visits: { fork: 1 } } })).trk).toBeUndefined();
    expect(textsOf(run()).trk).toBeUndefined();
  });

  it("runs while a node inside runs, and names that step without the shared lead", () => {
    const value = run({ nodeRuns: [row("impl", "running")] });
    expect(statusesOf(value).trk).toBe("running");
    expect(textsOf(value).trk).toBe("implement");
  });

  it("waits when the run's question is on a node inside", () => {
    const value = run({
      status: "waiting-human",
      pendingQuestion: { nodeId: "ask" },
      nodeRuns: [row("impl", "done", 10)],
    });
    expect(statusesOf(value).trk).toBe("waiting");
    expect(textsOf(value).trk).toBe("waiting · needs you");
    // The question elsewhere does not make it wait.
    const elsewhere = run({ status: "waiting-human", pendingQuestion: { nodeId: "check" } });
    expect(statusesOf(elsewhere).trk).toBeUndefined();
  });

  it("is done once a step whose only way out is End has finished", () => {
    const value = run({ nodeRuns: [row("impl", "done", 10), row("squash", "done", 20)] });
    expect(statusesOf(value).trk).toBe("done");
  });

  it("is done when the inner node that finished last routes to End", () => {
    const ending = graphSchema.parse({
      ...child,
      edges: [
        { from: "__start__", to: "impl" },
        { from: "impl", to: "__end__", when: { source: "output", key: "impl", op: "contains", value: "ok" } },
        { from: "impl", to: "ask" },
        { from: "ask", to: "impl" },
      ],
    });
    const value = run({
      embedded: [ending],
      nodeRuns: [row("impl", "done", 10)],
      state: { outputs: { impl: "all ok" } },
    });
    expect(statusesOf(value).trk).toBe("done");
    // Same node finished, but its answer routes on to the approval: not done.
    const onwards = run({
      embedded: [ending],
      nodeRuns: [row("impl", "done", 10)],
      state: { outputs: { impl: "not yet" } },
    });
    expect(statusesOf(onwards).trk).toBe("running");
    expect(textsOf(onwards).trk).toBe("1 of 3 steps");
  });

  it("is not done halfway: a finished first step only counts the steps", () => {
    const value = run({ status: "waiting-human", pendingQuestion: { nodeId: "check" }, nodeRuns: [row("impl", "done", 10)] });
    expect(statusesOf(value).trk).toBe("idle");
    expect(textsOf(value).trk).toBe("1 of 3 steps");
  });

  it("fails only once the run is over and nothing inside moves", () => {
    const failed = run({ status: "failed", nodeRuns: [row("impl", "failed", 10)] });
    expect(statusesOf(failed).trk).toBe("failed");
    expect(textsOf(failed).trk).toBe("failed · implement");
    // While the run still moves, a failed inner attempt is a retry or a
    // routed failure, not the subgraph's end.
    const live = run({ status: "running", nodeRuns: [row("impl", "failed", 10)] });
    expect(statusesOf(live).trk).toBe("running");
  });

  it("counts the steps of a finished run as done", () => {
    const value = run({ status: "done", nodeRuns: [row("impl", "done", 10)] });
    expect(statusesOf(value).trk).toBe("done");
  });

  it("stays idle when its graph cannot be resolved", () => {
    const value = run({ embedded: [], nodeRuns: [row("impl", "running")] });
    expect(runStatuses(value).statuses.trk).toBeUndefined();
  });

  it("prefers the run's own embedded graph over the caller's library", () => {
    const stale: Graph = { ...child, nodes: child.nodes.slice(0, 1) };
    const resolve = runResolver(run(), () => stale);
    expect(resolve("track")).toBe(child);
    expect(runResolver(run({ embedded: [] }), () => stale)("track")).toBe(stale);
  });
});

describe("fan-out and fallbacks", () => {
  const fanned = graphSchema.parse({
    id: "fan",
    name: "Fan",
    nodes: [
      { id: "list", label: "List", prompt: "x", fields: [{ name: "items", type: "list" }] },
      { id: "each", label: "Each", prompt: "{{item}}" },
    ],
    edges: [
      { from: "__start__", to: "list" },
      { from: "list", to: "each", fanOutOver: "list.items" },
      { from: "each", to: "__end__" },
    ],
  });

  it("keeps a fanned-out node running until every branch wrote its result", () => {
    const value = run({
      graph: fanned,
      nodeRuns: [row("each", "done", 5)],
      state: {
        fields: { list: { items: ["a", "b"] } },
        collected: { each: [{ visit: 1, text: "a" }] },
      },
    });
    expect(statusesOf(value).each).toBe("running");
    const all = run({
      graph: fanned,
      nodeRuns: [row("each", "done", 5)],
      state: {
        fields: { list: { items: ["a", "b"] } },
        collected: { each: [{ visit: 1, text: "a" }, { visit: 1, text: "b" }] },
      },
    });
    expect(statusesOf(all).each).toBe("done");
  });

  it("lists only the fallback nodes the run has not reached", () => {
    expect([...unreachedFallbacks(child, {})]).toEqual(["ask"]);
    expect([...unreachedFallbacks(child, { ask: "done" })]).toEqual([]);
    expect([...unreachedFallbacks(parent, {})]).toEqual([]);
  });

  it("names the reached nodes for the edge highlight", () => {
    expect([...reachedNodes({ a: "done", b: "idle", c: "waiting" })].sort()).toEqual(["a", "c"]);
  });
});
