import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { emptyRunState, renderPrompt, resolveNext, type Graph } from "../lib/graph";
import { compileRunSpec } from "../lib/task-dev";

const run = () => {
  const spec = JSON.parse(readFileSync(new URL("./fixtures/task-dev/demo/demo.run-spec.json", import.meta.url), "utf8"));
  const result = compileRunSpec(spec);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.run;
};
const node = (graph: Graph, id: string) => graph.nodes.find(node => node.id === id)!;

const cases = [
  ["track", "demo-2-wt", "demo-2-ask", "demo-2-impl", "demo-2-wt"],
  ["track", "demo-2-squash", "demo-2-ask", "demo-2-impl", "demo-2-squash"],
  ["track", "demo-2-gate", "demo-2-ask", "demo-2-impl", "demo-2-gate"],
  ["parent", "a-int", "a-ask", "a-fix", "a-int"],
  ["parent", "a-gate", "a-ask", "a-fix", "a-gate"],
  ["parent", "a-fold", "a-ask", "a-fix", "a-fold"],
  ["parent", "final-gate", "final-ask", "final-fix", "final-gate"],
  ["parent", "final-fold", "final-ask", "final-fix", "final-fold"],
  ["parent", "layers", "layers-ask", "layers", "layers"],
  ["parent", "submit", "layers-ask", "layers", "layers"],
] as const;

it.each(cases)("retries %s helper %s after the human corrects an error", (scope, helper, sharedAsk, _guide, retry) => {
  const compiled = run();
  const graph = scope === "track" ? compiled.children[0]! : compiled.graph;
  // The later structured-decision commit splits a shared human node by
  // reason; the same recovery contract must hold before and after that split.
  const ask = graph.nodes.some(n => n.id === `${helper}-ask`) ? `${helper}-ask` : sharedAsk;
  const state = emptyRunState("");
  state.fields[helper] = { ok: false, kind: "error" };
  state.fields[ask] = { decision: "GUIDE" };
  expect(resolveNext(graph, helper, state)).toBe(ask);
  expect(resolveNext(graph, ask, state)).toBe(retry);
});

it.each(cases)("keeps ordinary guidance routing without an error from %s helper %s", (scope, helper, sharedAsk, guide) => {
  const compiled = run();
  const graph = scope === "track" ? compiled.children[0]! : compiled.graph;
  const ask = graph.nodes.some(n => n.id === `${helper}-ask`) ? `${helper}-ask` : sharedAsk;
  const state = emptyRunState("");
  state.fields[helper] = { ok: true };
  state.fields[ask] = { decision: "GUIDE" };
  expect(resolveNext(graph, ask, state)).toBe(guide);
});

it.each(["demo-2-wt", "demo-2-squash"])("shows the human the error returned by %s", helper => {
  const graph = run().children[0]!;
  const ask = graph.nodes.some(n => n.id === `${helper}-ask`) ? `${helper}-ask` : "demo-2-ask";
  const state = emptyRunState("");
  state.outputs[helper] = JSON.stringify({ ok: false, kind: "error", error: "Base mismatch; correct the setup before retrying" });
  expect(renderPrompt(node(graph, ask).prompt, state)).toContain("Base mismatch; correct the setup before retrying");
});

it("returns an ordinary implementation question to the implementer", () => {
  const graph = run().children[0]!;
  const state = emptyRunState("");
  state.fields["demo-2-impl"] = { status: "NEEDS_HUMAN", question: "Which interface should this use?" };
  state.fields["demo-2-ask"] = { decision: "GUIDE" };
  expect(resolveNext(graph, "demo-2-impl", state)).toBe("demo-2-ask");
  expect(resolveNext(graph, "demo-2-ask", state)).toBe("demo-2-impl");
});
