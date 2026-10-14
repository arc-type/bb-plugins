import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { compileRunSpec } from "../lib/task-dev";
import { emptyRunState, resolveNext, type Graph } from "../lib/graph";

const spec = () => JSON.parse(readFileSync(new URL("./fixtures/task-dev/demo/demo.run-spec.json", import.meta.url), "utf8"));
const run = () => {
  const result = compileRunSpec(spec(), { helper: "/usr/bin/true" });
  if (!result.ok) throw new Error(result.errors.join());
  return result.run;
};
const node = (graph: Graph, id: string) => graph.nodes.find(n => n.id === id)!;

it("puts cross-cutting final fixes into the top layer's last commit", () => {
  const prompt = node(run().graph, "final-fix").prompt;
  expect(prompt).toContain("top layer’s last sub-task (DEMO-4)");
  expect(prompt).not.toContain("plain commit on top");
});

it.each([false, true])("checks for unlayered commits before submit (extra=%s)", extra => {
  const root = mkdtempSync(join(tmpdir(), "td-layers-"));
  try {
    const stack = join(root, ".worktrees/demo-1/_stack");
    mkdirSync(stack, { recursive: true });
    const git = (...args: string[]) => execFileSync("git", ["-C", stack, ...args], { stdio: "pipe" });
    git("init");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "layer");
    git("branch", spec().layers.at(-1).branch);
    if (extra) git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "omitted");
    const graph = run().graph;
    const result = spawnSync("bash", ["-c", node(graph, "layers").command], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(extra ? 1 : 0);
    if (extra) {
      const state = emptyRunState("");
      state.fields.layers = JSON.parse(result.stdout.trim());
      expect(resolveNext(graph, "layers", state)).toEqual("layers-ask");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each(["error", "red", "conflict", ""])("routes helper kind %s without changing legacy routing", kind => {
  const { graph, children } = run();
  for (const [g, id, ask, normal] of [
    [graph, "preflight", "preflight-ask", "a-fork"],
    [graph, "a-int", "a-ask", "a-fix"],
    [graph, "a-gate", "a-ask", "a-fix"],
    [graph, "a-fold", "a-ask", "a-ask"],
    [graph, "final-gate", "final-ask", "final-fix"],
    [graph, "final-fold", "final-ask", "final-ask"],
    [graph, "layers", "layers-ask", "layers-ask"],
    [graph, "submit", "layers-ask", "__end__"],
    [children[0]!, "demo-2-wt", "demo-2-ask", "demo-2-impl"],
    [children[0]!, "demo-2-gate", "demo-2-ask", "demo-2-gatefix"],
    [children[0]!, "demo-2-squash", "demo-2-ask", "__end__"],
  ] as const) {
    const state = emptyRunState("");
    state.fields[id] = { ok: false, kind };
    expect(node(g, id).fields.find(f => f.name === "kind")).toMatchObject({ optional: true, type: "string" });
    expect(resolveNext(g, id, state)).toBe(kind === "error" ? ask : normal);
  }
});

it.each([undefined, ["tools"], ["web2"]])("validates apps only with an allow-list: %j", apps => {
  const input = spec();
  input.apps = apps;
  expect(compileRunSpec(input).ok).toBe(!apps || apps.includes("tools"));
});

it("lets the CLI allow-list override the spec", () => {
  expect(compileRunSpec({ ...spec(), apps: ["web2"] }, { apps: ["tools"] }).ok).toBe(true);
  expect(compileRunSpec(spec(), { apps: [] }).ok).toBe(false);
});

it("renders visit counts, including nodes not yet visited", async () => {
  const { renderPrompt } = await import("../lib/graph");
  const state = emptyRunState("");
  state.visits["final-fix"] = 3;
  expect(renderPrompt("round {{visits.final-fix}} / {{visits.final-gate}}", state)).toBe("round 3 / 0");
});

it("validates visit placeholders against known nodes and rejects fan-out counts", async () => {
  const { validateGraph } = await import("../lib/graph");
  const graph = run().graph;
  node(graph, "final-fix").prompt = "{{visits.final-fix}}";
  const validate = () => validateGraph(graph, id => run().children.find(g => g.id === id) ?? null).filter(p => p.message.includes("visits."));
  expect(validate()).toEqual([]);
  node(graph, "final-fix").prompt = "{{visits.typo}} {{visits.final-critic}}";
  expect(validate()).toHaveLength(2);
});

it("puts round counts and limits into compiled repair and needs-you prompts", () => {
  const { graph, children } = run();
  for (const id of ["a-fix", "a-ask", "final-fix", "final-ask"]) expect(node(graph, id).prompt).toMatch(/round \{\{visits\./);
  for (const id of ["demo-2-fix", "demo-2-gatefix", "demo-2-ask"]) expect(node(children[0]!, id).prompt).toMatch(/round \{\{visits\./);
  expect(node(graph, "submit").prompt).not.toContain("{{visits.");
});
