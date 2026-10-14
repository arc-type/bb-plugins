// Command nodes: a shell command instead of a worker thread. Covered here:
// what the command line looks like after rendering (quoting is the safety
// line), how an exit code becomes a failed attempt or a routable answer, the
// working directory handed to a worker, and the shell runner itself.
import { describe, expect, it } from "vitest";
import {
  END_NODE,
  START_NODE,
  emptyRunState,
  graphSchema,
  parseFields,
  renderCommand,
  validateGraph,
  type Graph,
} from "../lib/graph";
import { compileGraph, type RuntimeHost } from "../lib/runtime";
import { CommandJobUncertain, TIMEOUT_EXIT, resolveIn, runShell } from "../lib/shell";

type Ran = { nodeId: string; command: string; cwd: string | null };

function host(
  answer: (ran: Ran) => { exitCode: number; stdout: string; stderr?: string },
  options: { withoutCommands?: boolean } = {},
) {
  const ran: Ran[] = [];
  const identities: Array<{ visit: number; attempt: number }> = [];
  const spawned: Array<{ nodeId: string; cwd: string | null; prompt: string }> = [];
  const finished: Array<{ status: string; error: string | null }> = [];
  const runtimeHost: RuntimeHost = {
    async spawn({ nodeId, cwd, prompt }) {
      spawned.push({ nodeId, cwd, prompt });
      return `thr_${nodeId}`;
    },
    async awaitThread(threadId) {
      return `output of ${threadId}`;
    },
    async sendMessage() {},
    async loadDialog() {
      return null;
    },
    async saveDialog() {},
    async onNodeStart() {
      return "node-run";
    },
    async onNodeThread() {},
    async onNodeFinish(_, patch) {
      finished.push({ status: patch.status, error: patch.error });
    },
    async onStateChange() {},
    log() {},
    async wait() {},
    ...(options.withoutCommands
      ? {}
      : {
          async runCommand({ nodeId, command, cwd, visit, attempt }) {
            identities.push({ visit, attempt });
            const entry = { nodeId, command, cwd };
            ran.push(entry);
            return { stderr: "", ...answer(entry) };
          },
        }),
  };
  return { runtimeHost, ran, spawned, finished, identities };
}

const graph = (nodes: unknown[], edges: unknown[]): Graph =>
  graphSchema.parse({ id: "cmd", name: "Command", nodes, edges });

describe("renderCommand", () => {
  const state = {
    ...emptyRunState("task"),
    fields: { wt: { path: "/tmp/a b", note: "it's $(rm -rf ~)" } },
  };

  it("renders each placeholder as one quoted shell word", () => {
    expect(renderCommand("ls {{wt.path}}", state)).toBe("ls '/tmp/a b'");
    expect(renderCommand("echo {{wt.note}}", state)).toBe(`echo 'it'\\''s $(rm -rf ~)'`);
  });

  it("leaves the rest of the command line alone", () => {
    expect(renderCommand(`git -C "$(pwd)" log | head -1`, state)).toBe(`git -C "$(pwd)" log | head -1`);
  });

  it("leaves an unknown placeholder standing, like a prompt does", () => {
    expect(renderCommand("echo {{nope}}", state)).toBe("echo {{nope}}");
  });

  it("renders a known node that has not run as an empty word", () => {
    expect(renderCommand("echo {{later}}", state, new Set(["later"]))).toBe("echo ''");
  });
});

describe("parseFields with structured values", () => {
  const fields = [{ name: "decisions", type: "string" as const, options: [], description: "" }];

  it("keeps an object readable as JSON instead of [object Object]", () => {
    const parsed = parseFields(fields, '{"decisions": {"ARC-5": "keep the env name"}}');
    expect(parsed.decisions).toBe('{"ARC-5":"keep the env name"}');
  });

  it("leaves a plain string as it was", () => {
    expect(parseFields(fields, '{"decisions": "none"}').decisions).toBe("none");
  });
});

describe("command nodes in the runtime", () => {
  const gateGraph = (failOnExit: boolean) =>
    graph(
      [
        {
          id: "gate",
          label: "Gate",
          kind: "command",
          command: "check {{input}}",
          failOnExit,
          maxAttempts: 1,
          fields: [{ name: "ok", type: "boolean" }],
        },
        { id: "green", label: "Green", prompt: "go on" },
        { id: "red", label: "Red", prompt: "fix" },
      ],
      [
        { from: START_NODE, to: "gate" },
        { from: "gate", to: "green", when: { source: "field", key: "gate.ok", op: "equals", value: "true" } },
        { from: "gate", to: "red" },
        { from: "green", to: END_NODE },
        { from: "red", to: END_NODE },
      ],
    );

  it("passes a visit and a new attempt for a command retry", async () => {
    let calls = 0;
    const fake = host(() => ({ exitCode: ++calls === 1 ? 1 : 0, stdout: '{"ok":true}' }));
    const g = gateGraph(true);
    g.nodes[0].maxAttempts = 2;
    g.nodes[0].onError = "route";
    await compileGraph(g, fake.runtimeHost).invoke(emptyRunState("task"));
    expect(fake.identities).toEqual([{ visit: 1, attempt: 1 }, { visit: 1, attempt: 2 }]);
  });

  it("uses the persisted attempt on reattachment instead of resetting to one", async () => {
    const fake = host(() => ({ exitCode: 0, stdout: '{"ok":true}' }));
    fake.runtimeHost.nodeAttempt = () => 7;
    await compileGraph(gateGraph(true), fake.runtimeHost).invoke(emptyRunState("task"));
    expect(fake.identities).toEqual([{ visit: 1, attempt: 7 }]);
  });

  it.each(["stop", "route"] as const)("does not retry uncertain remote side effects with onError=%s", async (onError) => {
    const fake = host(() => { throw new CommandJobUncertain("Host vm: connection lost"); });
    const g = gateGraph(true);
    g.nodes[0].maxAttempts = 3;
    g.nodes[0].onError = onError;
    await expect(compileGraph(g, fake.runtimeHost).invoke(emptyRunState("task"))).rejects.toThrow(/connection lost/);
    expect(fake.identities).toHaveLength(1);
  });

  it("routes on the JSON the command printed, without spawning a worker for it", async () => {
    const fake = host(() => ({ exitCode: 1, stdout: 'building…\n{"ok": false}' }));
    const out = await compileGraph(gateGraph(false), fake.runtimeHost).invoke(emptyRunState("web2"));
    expect(fake.ran).toEqual([{ nodeId: "gate", command: "check 'web2'", cwd: null }]);
    expect(out.fields.gate).toEqual({ ok: false });
    expect(fake.spawned.map((entry) => entry.nodeId)).toEqual(["red"]);
  });

  it("takes the green branch when the command says so", async () => {
    const fake = host(() => ({ exitCode: 0, stdout: '{"ok": true}' }));
    await compileGraph(gateGraph(false), fake.runtimeHost).invoke(emptyRunState("web2"));
    expect(fake.spawned.map((entry) => entry.nodeId)).toEqual(["green"]);
  });

  it("fails the attempt on a non-zero exit when failOnExit is on, with the output's tail", async () => {
    const fake = host(() => ({ exitCode: 2, stdout: "", stderr: "no such app" }));
    await expect(
      compileGraph(gateGraph(true), fake.runtimeHost).invoke(emptyRunState("web3")),
    ).rejects.toThrow(/exited with 2[\s\S]*no such app/);
    expect(fake.finished).toEqual([{ status: "failed", error: expect.stringMatching(/exited with 2/) }]);
  });

  it("fails rather than improvise when the host cannot run commands", async () => {
    const fake = host(() => ({ exitCode: 0, stdout: "" }), { withoutCommands: true });
    await expect(
      compileGraph(gateGraph(false), fake.runtimeHost).invoke(emptyRunState("web2")),
    ).rejects.toThrow(/cannot run commands/);
    expect(fake.spawned).toEqual([]);
  });

  it("hands a rendered working directory to the command and to a worker", async () => {
    const fake = host(() => ({ exitCode: 0, stdout: '{"path": "/repo/.worktrees/t/a"}' }));
    const g = graph(
      [
        { id: "wt", label: "Worktree", kind: "command", command: "make-wt", fields: [{ name: "path" }] },
        { id: "impl", label: "Implement", prompt: "work", cwd: "{{wt.path}}" },
        { id: "check", label: "Check", kind: "command", command: "true", cwd: "{{wt.path}}/sub" },
      ],
      [
        { from: START_NODE, to: "wt" },
        { from: "wt", to: "impl" },
        { from: "impl", to: "check" },
        { from: "check", to: END_NODE },
      ],
    );
    await compileGraph(g, fake.runtimeHost).invoke(emptyRunState("t"));
    expect(fake.spawned).toEqual([expect.objectContaining({ nodeId: "impl", cwd: "/repo/.worktrees/t/a" })]);
    expect(fake.ran[1]).toEqual({ nodeId: "check", command: "true", cwd: "/repo/.worktrees/t/a/sub" });
  });

  it("spawns a worker without a working directory into the run's environment", async () => {
    const fake = host(() => ({ exitCode: 0, stdout: "" }));
    const g = graph(
      [{ id: "impl", label: "Implement", prompt: "work" }],
      [
        { from: START_NODE, to: "impl" },
        { from: "impl", to: END_NODE },
      ],
    );
    await compileGraph(g, fake.runtimeHost).invoke(emptyRunState("t"));
    expect(fake.spawned[0]!.cwd).toBeNull();
  });
});

describe("validating command nodes", () => {
  const one = (extra: Record<string, unknown>, edges: unknown[] = []) =>
    graph(
      [{ id: "run", label: "Run", kind: "command", ...extra }],
      [{ from: START_NODE, to: "run" }, { from: "run", to: END_NODE }, ...edges],
    );

  it("refuses a command node without a command", () => {
    expect(validateGraph(one({ command: "  " }))).toContainEqual({
      level: "error",
      message: '"Run" is a command node without a command.',
    });
  });

  it("accepts a command node with a command and declared fields, and asks for no prompt", () => {
    expect(validateGraph(one({ command: "true", fields: [{ name: "ok", type: "boolean" }] }))).toEqual([]);
  });

  it("checks placeholders in the command and the working directory", () => {
    const messages = validateGraph(one({ command: "ls {{wt.path}}", cwd: "{{typo}}" })).map((p) => p.message);
    expect(messages).toContainEqual(expect.stringMatching(/reads \{\{wt\.path\}\}, but there is no node "wt"/));
    expect(messages).toContainEqual(expect.stringMatching(/writes \{\{typo\}\}/));
  });

  it("warns about a working directory on a node that runs nothing", () => {
    const g = graph(
      [{ id: "wait", label: "Wait", kind: "human", prompt: "ok?", cwd: "/tmp" }],
      [
        { from: START_NODE, to: "wait" },
        { from: "wait", to: END_NODE },
      ],
    );
    expect(validateGraph(g).map((p) => p.message)).toContainEqual(
      '"Wait" is a Approval node and runs nothing; its working directory goes unused.',
    );
  });
});

describe("runShell", () => {
  it("returns exit code and both streams, without rejecting a failure", async () => {
    const result = await runShell({ command: "echo out; echo err >&2; exit 3", cwd: "/tmp", timeoutMs: 10_000 });
    expect(result).toMatchObject({ exitCode: 3, stdout: "out\n" });
    // A login shell may add its own lines in front; the command's come last.
    expect(result.stderr).toMatch(/err\n$/);
  });

  it("runs in the directory it is given", async () => {
    const result = await runShell({ command: "pwd -P", cwd: "/tmp", timeoutMs: 10_000 });
    expect(result.stdout.trim()).toMatch(/\/tmp$/);
  });

  it("kills a command that outlives its timeout and says so", async () => {
    const result = await runShell({ command: "sleep 5", cwd: "/tmp", timeoutMs: 200 });
    expect(result.exitCode).toBe(TIMEOUT_EXIT);
    expect(result.stderr).toMatch(/Killed after/);
  });

  it("rejects when the run is stopped, killing what the command started", async () => {
    const controller = new AbortController();
    const running = runShell({ command: "sleep 5", cwd: "/tmp", timeoutMs: 10_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await expect(running).rejects.toThrow(/stopped/);
  });

  it("reads a relative directory against the environment root", () => {
    expect(resolveIn("/repo", ".worktrees/a")).toBe("/repo/.worktrees/a");
    expect(resolveIn("/repo", "/abs")).toBe("/abs");
    expect(resolveIn("/repo", null)).toBe("/repo");
  });
});
