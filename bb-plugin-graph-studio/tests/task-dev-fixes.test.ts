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
