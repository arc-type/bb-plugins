// The task-dev compiler: a run spec becomes a parent graph plus one embedded
// graph per track. What matters is that the result is a graph the validator
// accepts as it stands, that the structure it promises (lanes, joins, layer
// branches) is really there, and that the rules the old workflow engine
// enforced at run time now refuse a bad spec before anything runs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { joinGroups, validateGraph, type Graph } from "../lib/graph";
import { compileRunSpec, specErrors, runSpecSchema, type CompiledRun } from "../lib/task-dev";

const arc4 = () =>
  JSON.parse(readFileSync(new URL("./fixtures/task-dev/arc-4.run-spec.json", import.meta.url), "utf8"));
const demo = () =>
  JSON.parse(readFileSync(new URL("./fixtures/task-dev/demo/demo.run-spec.json", import.meta.url), "utf8"));

function compiled(spec: unknown): CompiledRun {
  const result = compileRunSpec(spec);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.run;
}

function resolverFor(run: CompiledRun) {
  const all = new Map<string, Graph>([run.graph, ...run.children].map((graph) => [graph.id, graph]));
  return (id: string) => all.get(id) ?? null;
}

const node = (graph: Graph, id: string) => graph.nodes.find((entry) => entry.id === id);

describe("compileRunSpec on the ARC-4 spec", () => {
  it("produces graphs the validator accepts without a single finding", () => {
    const run = compiled(arc4());
    expect(validateGraph(run.graph, resolverFor(run))).toEqual([]);
    for (const child of run.children) {
      expect(validateGraph(child, resolverFor(run))).toEqual([]);
    }
  });

  it("embeds one track graph per sub-task, in the group it belongs to", () => {
    const run = compiled(arc4());
    expect(run.children.map((child) => child.id)).toHaveLength(11);
    expect(node(run.graph, "trk-arc-12")).toMatchObject({ kind: "subgraph", graphId: "td-arc-4-arc-12" });
    // Group B starts where group A ended, not straight after preflight.
    const intoB = run.graph.edges.filter((edge) => edge.to === "b-fork").map((edge) => edge.from);
    expect(intoB).toEqual(["a-check"]);
  });

  it("spreads group A over maxParallel lanes and joins them before integrating", () => {
    const run = compiled(arc4());
    const groupA = run.plan.find((group) => group.group === "A")!;
    expect(groupA.lanes).toHaveLength(3);
    expect(groupA.lanes.flat().sort()).toEqual(["ARC-10", "ARC-11", "ARC-5", "ARC-6", "ARC-7", "ARC-8", "ARC-9"]);
    // Recognised as a structured join: integration waits for every lane once.
    const joins = joinGroups(run.graph);
    expect(joins.get("a-join")).toHaveLength(3);
    expect(joins.get("b-join")).toHaveLength(2);
  });

  it("puts tracks whose files overlap into one lane, the later building on the earlier", () => {
    const spec = demo();
    spec.groups[0].tracks[1].files = ["greet.sh"];
    const run = compiled(spec);
    expect(run.plan[0]!.lanes).toEqual([["DEMO-2", "DEMO-3"]]);
    const later = run.children.find((child) => child.id === "td-demo-1-demo-3")!;
    expect(node(later, "demo-3-wt")!.command).toContain(".worktrees/demo-1/demo-2");
    // Independent tracks start from the stack instead.
    const independent = compiled(demo()).children.find((child) => child.id === "td-demo-1-demo-3")!;
    expect(node(independent, "demo-3-wt")!.command).toContain(".worktrees/demo-1/_stack");
  });

  it("moves each layer branch with the last track of its layer", () => {
    const run = compiled(arc4());
    const pick = node(run.graph, "a-int")!.command;
    expect(pick).toContain(':arc-4/a2-highlights-extraction"');
    // ARC-6 is not the end of its layer; ARC-7 is.
    expect(pick).toMatch(/arc-6' rev-parse HEAD\)" /);
  });

  it("adds a checkpoint only after the groups the spec names", () => {
    const run = compiled(arc4());
    expect(node(run.graph, "a-check")).toMatchObject({ kind: "human" });
    expect(node(run.graph, "b-check")).toBeUndefined();
    expect(node(run.graph, "b-done")).toMatchObject({ kind: "note" });
  });

  it("submits only when the spec is not a dry run", () => {
    expect(node(compiled(arc4()).graph, "submit")).toBeDefined();
    const dry = compiled({ ...arc4(), dryRun: true });
    expect(node(dry.graph, "submit")).toBeUndefined();
    // A dry run still passes the final gate; it just ends there.
    expect(dry.graph.edges).toContainEqual(expect.objectContaining({ from: "final-gate", to: "__end__" }));
    expect(dry.graph.edges).not.toContainEqual(expect.objectContaining({ from: "final-gate", to: "layers" }));
  });

  it("uses the models of the spec, and the defaults for roles it leaves out", () => {
    const run = compiled(demo());
    const child = run.children[0]!;
    expect(node(child, "demo-2-impl")).toMatchObject({ providerId: "claude-code", model: "claude-haiku-5-5" });
    const defaults = compiled(arc4()).children[0]!;
    expect(node(defaults, "arc-5-impl")).toMatchObject({ providerId: "codex", model: "gpt-6.1-sol" });
  });
});

describe("what keeps a compiled run legible and cheap", () => {
  it("keeps repair counters and questions on fallback paths", () => {
    const track = compiled(demo()).children[0]!;
    for (const id of ["demo-2-red-round", "demo-2-gatefix"]) expect(node(track, id)!.path).toBe("fallback");
    const questions = track.nodes.filter(entry => entry.kind === "dialog");
    expect(questions.map(entry => entry.id).sort()).toEqual(["demo-2-ask", "demo-2-fix-ask", "demo-2-gate-ask", "demo-2-gatefix-ask", "demo-2-squash-ask", "demo-2-wt-ask"]);
    expect(questions.every(entry => entry.path === "fallback")).toBe(true);
    expect(node(track, "demo-2-review-round")!.path).toBe("main");
  });

  it("marks the group's fixer, fold and approval as fallback, but not the checkpoint", () => {
    const parent = compiled(arc4()).graph;
    for (const id of ["a-fix", "a-fold", "a-ask", "final-ask", "layers-ask"]) {
      expect(node(parent, id)!.path).toBe("fallback");
    }
    for (const id of ["a-int", "a-gate", "a-check", "final-fix", "final-fold", "final-gate", "layers", "submit"]) {
      expect(node(parent, id)!.path).toBe("main");
    }
  });

  it("uses structured dialogs for contingencies and human nodes for checkpoints", () => {
    const run = compiled(arc4());
    for (const graph of [run.graph, ...run.children]) {
      for (const ask of graph.nodes.filter(entry => entry.kind === "dialog")) {
        expect(ask.fields.find(field => field.name === "decision")!.options).toEqual(["GUIDE", "ACCEPT"]);
      }
    }
    expect(run.graph.nodes.filter(entry => entry.kind === "human").map(entry => entry.id)).toEqual(["a-check"]);
  });

  it("merges conflict resolution and the red gate into one stack fixer per group", () => {
    const parent = compiled(arc4()).graph;
    expect(node(parent, "a-resolve")).toBeUndefined();
    expect(node(parent, "a-gfix")).toBeUndefined();
    const into = (to: string) => parent.edges.filter((edge) => edge.to === to).map((edge) => edge.from);
    expect(into("a-fix").sort()).toEqual(["a-ask", "a-conflict-round", "a-fold-ask", "a-gate-ask", "a-int-ask", "a-red-round"]);
    const from = parent.edges.filter((edge) => edge.from === "a-fix").map((edge) => edge.to);
    expect(from).toEqual(["a-int", "a-fold", "a-ask", "a-ask-exhausted"]);
  });

  it("continues the implementer's thread for both fixes, and each critic's own", () => {
    const track = compiled(demo()).children[0]!;
    expect(node(track, "demo-2-impl")!.continueThread).toBe("demo-2-impl");
    expect(node(track, "demo-2-gatefix")!.continueThread).toBe("demo-2-impl");
    expect(node(track, "demo-2-fix")!.continueThread).toBe("demo-2-impl");
    expect(node(track, "demo-2-critic")!.continueThread).toBe("demo-2-critic");
    // Commands and approvals spawn nothing to continue.
    expect(node(track, "demo-2-gate")!.continueThread).toBe("");
    const parent = compiled(demo()).graph;
    expect(node(parent, "a-fix")!.continueThread).toBe("a-fix");
    expect(node(parent, "final-fix")!.continueThread).toBe("final-fix");
    expect(node(parent, "final-critic")!.continueThread).toBe("");
  });

  it("lets a worker leave out the question when it has none, and only the question", () => {
    const track = compiled(demo()).children[0]!;
    const impl = node(track, "demo-2-impl")!;
    expect(impl.fields.find((entry) => entry.name === "question")!.optional).toBe(true);
    expect(impl.fields.find((entry) => entry.name === "status")!.optional).toBe(false);
    expect(impl.fields.find((entry) => entry.name === "summary")!.optional).toBe(false);
  });

  it("tags every compiled graph as generated and hides its workers", () => {
    const run = compiled(demo());
    for (const graph of [run.graph, ...run.children]) {
      expect(graph.tags).toEqual(["dynamic", "ticket:demo-1"]);
      expect(graph.workerVisibility).toBe("hidden");
    }
  });
});

describe("run spec rules", () => {
  const parse = (spec: unknown) => runSpecSchema.parse(spec);

  it("accepts the fixtures", () => {
    expect(specErrors(parse(arc4()))).toEqual([]);
    expect(specErrors(parse(demo()))).toEqual([]);
  });

  it("refuses a duplicate track key", () => {
    const spec = demo();
    spec.groups[1].tracks[0].key = "DEMO-2";
    expect(specErrors(parse(spec)).join()).toMatch(/duplicate track keys: DEMO-2/);
  });

  it("refuses a track that sits in no layer", () => {
    const spec = demo();
    spec.layers.pop();
    expect(specErrors(parse(spec)).join()).toMatch(/DEMO-4 sits in 0 layers/);
  });

  it("refuses layers that go back to an earlier group", () => {
    const spec = demo();
    spec.layers = [spec.layers[2], spec.layers[0], spec.layers[1]];
    expect(specErrors(parse(spec)).join()).toMatch(/layers go back from group B to A/);
  });

  it("refuses group letters that do not ascend", () => {
    const spec = demo();
    spec.groups.reverse();
    expect(specErrors(parse(spec)).join()).toMatch(/group letters must ascend/);
  });

  it("refuses an unknown lens", () => {
    const spec = demo();
    spec.groups[0].tracks[0].critics = ["vibes"];
    expect(specErrors(parse(spec)).join()).toMatch(/unknown lens "vibes"/);
  });

  it("reports schema errors instead of throwing", () => {
    const result = compileRunSpec({ ticket: "X-1" });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.join()).toMatch(/groups/);
  });
});
