// A fixture run with start, a fan-out/join (diamond), a loop and a running
// step — every case `taken`/`now` need to tell apart.
import { describe, expect, it } from "vitest";
import { taken, now } from "../lib/edge-state";
import { graphSchema } from "../lib/graph";
import type { CanvasRun } from "../lib/canvas-layer";

// __start__ → a → b → d → __end__
//                 \> c →/
// d → a (retry loop)
const graph = graphSchema.parse({
  id: "diamond",
  name: "Diamond",
  nodes: [
    { id: "a", label: "Plan" },
    { id: "b", label: "Build" },
    { id: "c", label: "Review" },
    { id: "d", label: "Ship" },
  ],
  edges: [
    { from: "__start__", to: "a" },
    { from: "a", to: "b" },
    { from: "a", to: "c" },
    { from: "b", to: "d" },
    { from: "c", to: "d" },
    { from: "d", to: "a", label: "retry" },
    { from: "d", to: "__end__" },
  ],
});

const run = (nodeRuns: CanvasRun["nodeRuns"]): CanvasRun => ({
  id: "r1",
  graph,
  status: "running",
  threadId: null,
  createdAt: 0,
  nodeRuns,
});

describe("taken", () => {
  it("is empty for a run with no attempts yet, without throwing", () => {
    expect(() => taken(run([]))).not.toThrow();
    expect(taken(run([]))).toEqual(new Set());
  });

  it("marks the start edge taken once its target has an attempt", () => {
    expect(taken(run([{ nodeId: "a", attempt: 1, status: "running" }]))).toEqual(
      new Set(["__start__→a"]),
    );
  });

  it("only marks the branch actually taken in a fan-out, not the other one", () => {
    const keys = taken(
      run([
        { nodeId: "a", attempt: 1, status: "done" },
        { nodeId: "b", attempt: 1, status: "done" },
      ]),
    );
    expect(keys.has("a→b")).toBe(true);
    expect(keys.has("a→c")).toBe(false);
  });

  it("requires the join's source to have its own attempt too", () => {
    // d has an attempt, but b (one of its two possible sources) never ran —
    // only the branch that actually ran (c) should count.
    const keys = taken(
      run([
        { nodeId: "a", attempt: 1, status: "done" },
        { nodeId: "c", attempt: 1, status: "done" },
        { nodeId: "d", attempt: 1, status: "done" },
      ]),
    );
    expect(keys.has("c→d")).toBe(true);
    expect(keys.has("b→d")).toBe(false);
  });

  it("marks a back edge taken only once its target has a second attempt", () => {
    const oneAttempt = run([
      { nodeId: "a", attempt: 1, status: "done" },
      { nodeId: "b", attempt: 1, status: "done" },
      { nodeId: "d", attempt: 1, status: "done" },
    ]);
    expect(taken(oneAttempt).has("d→a")).toBe(false);

    const twoAttempts = run([
      { nodeId: "a", attempt: 1, status: "done" },
      { nodeId: "b", attempt: 1, status: "done" },
      { nodeId: "d", attempt: 1, status: "done" },
      { nodeId: "a", attempt: 2, status: "running" },
    ]);
    expect(taken(twoAttempts).has("d→a")).toBe(true);
  });

  it("does not count a skipped attempt towards taken, by lead decision", () => {
    const keys = taken(
      run([
        { nodeId: "a", attempt: 1, status: "done" },
        { nodeId: "b", attempt: 1, status: "skipped" },
      ]),
    );
    expect(keys.has("a→b")).toBe(false);
  });
});

describe("now", () => {
  it("is empty for a run with no attempts, without throwing", () => {
    expect(() => now(run([]))).not.toThrow();
    expect(now(run([]))).toEqual(new Set());
  });

  it("is the subset of taken whose target's latest attempt is running", () => {
    const keys = now(
      run([
        { nodeId: "a", attempt: 1, status: "done" },
        { nodeId: "b", attempt: 1, status: "running" },
      ]),
    );
    expect(keys.has("a→b")).toBe(true);
    expect(keys.has("__start__→a")).toBe(false);
  });

  it("uses the latest attempt, not an earlier failed one, to judge running", () => {
    const keys = now(
      run([
        { nodeId: "a", attempt: 1, status: "failed" },
        { nodeId: "a", attempt: 2, status: "running" },
      ]),
    );
    expect(keys.has("__start__→a")).toBe(true);
  });

  it("marks both branches of a parallel fan-out as now at once", () => {
    const keys = now(
      run([
        { nodeId: "a", attempt: 1, status: "done" },
        { nodeId: "b", attempt: 1, status: "running" },
        { nodeId: "c", attempt: 1, status: "running" },
      ]),
    );
    expect(keys.has("a→b")).toBe(true);
    expect(keys.has("a→c")).toBe(true);
  });

  it("marks a back edge now while its target's retry attempt is running", () => {
    const keys = now(
      run([
        { nodeId: "a", attempt: 1, status: "done" },
        { nodeId: "b", attempt: 1, status: "done" },
        { nodeId: "d", attempt: 1, status: "done" },
        { nodeId: "a", attempt: 2, status: "running" },
      ]),
    );
    expect(keys.has("d→a")).toBe(true);
  });

  it("does not mark a finished edge as now", () => {
    const keys = now(
      run([
        { nodeId: "a", attempt: 1, status: "done" },
        { nodeId: "b", attempt: 1, status: "done" },
      ]),
    );
    expect(keys.has("a→b")).toBe(false);
  });
});
