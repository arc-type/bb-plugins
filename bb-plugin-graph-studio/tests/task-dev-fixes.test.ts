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
    expect(result.status).toBe(extra ? 2 : 0);
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
    [graph, "a-int", "a-int-ask", "a-conflict-round"],
    [graph, "a-gate", "a-gate-ask", "a-red-round"],
    [graph, "a-fold", "a-fold-ask", "a-fold-ask"],
    [graph, "final-gate", "final-gate-ask", "final-red-round"],
    [graph, "final-fold", "final-fold-ask", "final-fold-ask"],
    [graph, "layers", "layers-ask", "layers-ask"],
    [graph, "submit", "submit-ask", "__end__"],
    [children[0]!, "demo-2-wt", "demo-2-wt-ask", "demo-2-impl"],
    [children[0]!, "demo-2-gate", "demo-2-gate-ask", "demo-2-red-round"],
    [children[0]!, "demo-2-squash", "demo-2-squash-ask", "__end__"],
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

it("regates a FIXED result on the last review round before asking for acceptance", () => {
  const graph = run().children[0]!;
  const state = emptyRunState("");
  state.visits["demo-2-review-round"] = node(graph, "demo-2-review-round").maxVisits;
  state.visits["demo-2-critic"] = 50;
  state.fields["demo-2-fix"] = { status: "FIXED" };
  expect(resolveNext(graph, "demo-2-fix", state)).toBe("demo-2-gate");
  state.fields["demo-2-gate"] = { ok: true };
  expect(resolveNext(graph, "demo-2-gate", state)).toBe("demo-2-gate-ask");
  state.visits["demo-2-review-round"] = 0;
  expect(resolveNext(graph, "demo-2-gate", state)).toBe("demo-2-review-round");
  state.fields["demo-2-fix"] = { status: "NEEDS_HUMAN" };
  expect(resolveNext(graph, "demo-2-fix", state)).toBe("demo-2-fix-ask");
});

it("keeps conflict and gate repair budgets independent at their boundaries", () => {
  const graph = run().graph;
  const state = emptyRunState("");
  state.fields["a-int"] = { ok: false };
  state.fields["a-gate"] = { ok: false };
  state.visits["a-fix"] = 8;
  state.visits["a-conflict-round"] = 4;
  expect(resolveNext(graph, "a-int", state)).toBe("a-int-ask");
  expect(resolveNext(graph, "a-gate", state)).toBe("a-red-round");
  state.visits["a-conflict-round"] = 3;
  state.visits["a-red-round"] = 4;
  expect(resolveNext(graph, "a-int", state)).toBe("a-conflict-round");
  expect(resolveNext(graph, "a-gate", state)).toBe("a-gate-ask");
});

it("counts review rounds before fan-out and gate repairs independently", () => {
  const graph = run().children[0]!;
  const state = emptyRunState("");
  state.fields["demo-2-gate"] = { ok: true };
  expect(resolveNext(graph, "demo-2-gate", state)).toBe("demo-2-review-round");
  expect(resolveNext(graph, "demo-2-review-round", state)).toBe("demo-2-lenses");
  state.fields["demo-2-gate"] = { ok: false };
  expect(resolveNext(graph, "demo-2-gate", state)).toBe("demo-2-red-round");
  state.visits["demo-2-red-round"] = node(graph, "demo-2-red-round").maxVisits;
  expect(resolveNext(graph, "demo-2-gate", state)).toBe("demo-2-gate-ask");
});

it.each(["GUIDE", "ACCEPT"])("routes the human's %s decision for each stage", decision => {
  const { graph, children } = run();
  for (const [g, id, guide, accept] of [
    [children[0]!, "demo-2-ask", "demo-2-impl", "demo-2-squash"],
    [children[0]!, "demo-2-fix-ask", "demo-2-impl", "demo-2-squash"],
    [graph, "a-ask", "a-fix", "a-int"],
    [graph, "a-gate-ask", "a-fix", "a-check"],
    [graph, "final-ask", "final-fix", "final-fold"],
    [graph, "final-gate-ask", "final-fix", "layers"],
    [graph, "layers-ask", "layers", "submit"],
  ] as const) {
    const state = emptyRunState("");
    state.fields[id] = { decision };
    expect(node(g, id).kind).toBe("dialog");
    expect(resolveNext(g, id, state)).toBe(decision === "GUIDE" ? guide : accept);
  }
});

it("does not let acceptance bypass helper errors or unfinished deterministic steps", () => {
  const { graph, children } = run();
  for (const [g, source, ask, retry] of [
    [graph, "preflight", "preflight-ask", "preflight"],
    [graph, "a-int", "a-int-ask", "a-int"],
    [graph, "a-fold", "a-fold-ask", "a-fold"],
    [graph, "a-gate", "a-gate-ask", "a-gate"],
    [graph, "layers", "layers-ask", "layers"],
    [graph, "submit", "submit-ask", "layers"],
    [children[0]!, "demo-2-wt", "demo-2-wt-ask", "demo-2-wt"],
  ] as const) {
    const state = emptyRunState("");
    state.fields[source] = { kind: "error" };
    state.fields[ask] = { decision: "ACCEPT" };
    expect(resolveNext(g, ask, state)).toBe(retry);
  }
  const state = emptyRunState("");
  state.fields["a-fold-ask"] = { decision: "ACCEPT" };
  expect(resolveNext(graph, "a-fold-ask", state)).toBe("a-fold");
  expect(node(graph, "submit").command).toContain("rev-list");
});

it("shows only the question from the worker that caused this visit", async () => {
  const { renderPrompt } = await import("../lib/graph");
  const graph = run().children[0]!;
  const state = emptyRunState("");
  state.fields["demo-2-impl"] = { question: "Old implementation question", summary: "old" };
  state.fields["demo-2-gatefix"] = { question: "Old gate question", summary: "old" };
  state.fields["demo-2-fix"] = { question: "Current review question", summary: "current" };
  const prompt = renderPrompt(node(graph, "demo-2-fix-ask").prompt, state);
  expect(prompt).toContain("Current review question");
  expect(prompt).not.toContain("Old implementation question");
  expect(prompt).not.toContain("Old gate question");
  state.fields["demo-2-fix"] = { question: "", summary: "no question" };
  expect(renderPrompt(node(graph, "demo-2-fix-ask").prompt, state)).not.toContain("Current review question");
});

it("resumes a needs-you dialog with guidance and then acceptance without stale questions", async () => {
  const { Command, MemorySaver } = await import("@langchain/langgraph");
  const { compileGraph } = await import("../lib/runtime");
  const { graphSchema } = await import("../lib/graph");
  const child = run().children[0]!;
  const source = { ...node(child, "demo-2-fix"), prompt: "Ask for guidance", cwd: "", continueThread: "" };
  const ask = { ...node(child, "demo-2-fix-ask"), prompt: node(child, "demo-2-fix-ask").prompt.replace(/\{\{visits\.[^}]+\}\}/g, "0") };
  const graph = graphSchema.parse({ id: "needs-you-resume", name: "Needs you", example: "Guide a repair",
    nodes: [source, ask], edges: [
      { from: "__start__", to: source.id }, { from: source.id, to: ask.id },
      { from: ask.id, to: source.id, when: { source: "field", key: `${ask.id}.decision`, op: "equals", value: "GUIDE" } },
      { from: ask.id, to: "__end__", when: { source: "field", key: `${ask.id}.decision`, op: "equals", value: "ACCEPT" } },
    ] });
  const prompts = new Map<string, string>();
  const answers = new Map<string, string>();
  const sessions = new Map<string, { threadId: string; turns: number }>();
  let calls = 0;
  const host: import("../lib/runtime").RuntimeHost = {
    async spawn({ nodeId, prompt }) { const id = `${nodeId}:${prompts.size}`; prompts.set(id, prompt); return id; },
    async awaitThread(id) {
      if (id.startsWith(`${source.id}:`)) return JSON.stringify({ status: "NEEDS_HUMAN", summary: "current", question: `Question ${++calls}` });
      const answer = answers.get(id);
      return answer ? JSON.stringify({ done: true, decision: answer, guidance: "Human guidance" }) : JSON.stringify({ done: false, question: prompts.get(id) });
    },
    async sendMessage(id, answer) { answers.set(id, answer); },
    async loadDialog(id, visit) { return sessions.get(`${id}:${visit}`) ?? null; },
    async saveDialog(id, visit, session) { sessions.set(`${id}:${visit}`, session); },
    async onNodeStart(id) { return id; }, async onNodeThread() {}, async onNodeFinish() {}, async onStateChange() {}, log() {},
  };
  const app = compileGraph(graph, host, new MemorySaver());
  const config = { configurable: { thread_id: "needs-you-test" } };
  await app.invoke(emptyRunState(""), config);
  const question = async () => (await app.getState(config)).tasks.flatMap(t => t.interrupts ?? []).map(i => (i.value as { question: string }).question).join();
  expect(await question()).toContain("Question 1");
  await app.invoke(new Command({ resume: "GUIDE" }), config);
  expect(await question()).toContain("Question 2");
  expect(await question()).not.toContain("Question 1");
  const done = await app.invoke(new Command({ resume: "ACCEPT" }), config);
  expect(done.fields[ask.id]?.decision).toBe("ACCEPT");
  expect(done.visits[source.id]).toBe(2);
  expect(await question()).toBe("");
});

it("requires a valid human decision while allowing guidance to be omitted", async () => {
  const { parseFields } = await import("../lib/graph");
  const fields = node(run().graph, "final-ask").fields;
  expect(parseFields(fields, '{"decision":"GUIDE","guidance":"Resolve the API mismatch"}')).toEqual({ decision: "GUIDE", guidance: "Resolve the API mismatch" });
  expect(parseFields(fields, '{"decision":"ACCEPT"}')).toEqual({ decision: "ACCEPT", guidance: "" });
  expect(() => parseFields(fields, '{"decision":"SKIP_TRACK"}')).toThrow();
  expect(() => parseFields(fields, '{"guidance":"Go on"}')).toThrow();
});

it("does not fall through to fixers or silently end when assistance runs out", () => {
  const graph = run().graph;
  const state = emptyRunState("");
  state.fields["a-gate"] = { ok: false, kind: "error" };
  state.visits["a-gate-ask"] = node(graph, "a-gate-ask").maxVisits;
  expect(resolveNext(graph, "a-gate", state)).toBe("a-ask-exhausted");
  state.fields["a-gate-ask"] = { decision: "GUIDE" };
  state.fields["a-gate"] = { ok: false, kind: "red" };
  state.visits["a-fix"] = node(graph, "a-fix").maxVisits;
  expect(resolveNext(graph, "a-gate-ask", state)).toBe("a-ask-exhausted");
  const child = run().children[0]!;
  state.fields["demo-2-gate"] = { ok: true };
  state.visits["demo-2-review-round"] = node(child, "demo-2-review-round").maxVisits;
  state.visits["demo-2-gate-ask"] = node(child, "demo-2-gate-ask").maxVisits;
  expect(resolveNext(child, "demo-2-gate", state)).toBe("demo-2-ask-exhausted");
});

it.each([false, true])("passes --dry-run to preflight only for a dry-run spec (dryRun=%s)", dryRun => {
  const result = compileRunSpec({ ...spec(), dryRun }, { helper: "/usr/bin/true" });
  if (!result.ok) throw new Error(result.errors.join());
  const command = node(result.run.graph, "preflight").command;
  if (dryRun) expect(command).toContain("preflight 'DEMO-1' --dry-run)");
  else expect(command).not.toContain("--dry-run");
});
