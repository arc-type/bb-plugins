import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import graphStudio from "../server";
import { graphSchema } from "../lib/graph";
import { createStore } from "../lib/store";

const hosts: FakePluginHost[] = [];
afterEach(async () => { for (const h of hosts.splice(0)) await h.harness.lifecycle.dispose(); });
const graph = graphSchema.parse({
  id: "remote-command", name: "Remote Command",
  nodes: [{ id: "gate", label: "Gate", kind: "command", command: "printf done", cwd: "track", maxAttempts: 1 }],
  edges: [{ from: "__start__", to: "gate" }, { from: "gate", to: "__end__" }],
});
function setup(options: { hostId?: string; failure?: Error; hold?: boolean; waitForEnvironment?: () => Promise<void> } = {}) {
  const starts: Array<{ jobId: string; cwd: string; command: string }> = [];
  let done = !options.hold;
  const host = createFakePluginHost({
    pluginId: "graph-studio",
    sdk: {
      threads: { get: async () => ({ environmentId: "env", providerId: "pi" }), events: { list: async () => [] }, stop: async () => ({}) },
      environments: { get: async () => { await options.waitForEnvironment?.(); return { path: "/remote/repo", hostId: options.hostId ?? "host_vm" }; } },
      system: { config: async () => ({ primaryHostId: "host_local" }) },
    } as never,
    experimental_callHostRpc: async ({ method, input, hostId }) => {
      expect(hostId).toBe(options.hostId ?? "host_vm");
      if (options.failure) throw options.failure;
      if (method === "start") { starts.push(input as never); return { started: true }; }
      if (method === "stop") return { stopped: true };
      const planner = starts.find((entry) => entry.jobId === (input as { jobId: string }).jobId)?.command === "items";
      const exited = done || planner;
      return { state: exited ? "exited" : "running", exitCode: exited ? 0 : null, stdoutTail: planner ? '{"items":["a","b"]}' : "done", stderrTail: "", nextOffset: 4 };
    },
  });
  hosts.push(host);
  graphStudio(host.bb);
  return { host, starts, finish: () => { done = true; }, fail: (cause?: Error) => { options.failure = cause; } };
}
async function start(host: FakePluginHost, target = graph) {
  await host.harness.behavior.callRpc("saveGraph", { graph: target });
  const result = await host.harness.behavior.callRpc("startRun", { graphId: target.id, input: "task", threadId: "parent", projectId: null }) as { run: { id: string } };
  return result.run.id;
}
const store = (host: FakePluginHost) => createStore(host.bb.storage.database());

describe("remote command server wiring", () => {
  it("uses the environment host, resolves cwd there and records a command without a worker", async () => {
    const { host, starts } = setup();
    const id = await start(host);
    await vi.waitFor(() => expect(store(host).getRun(id)?.status).toBe("done"));
    expect(starts).toHaveLength(1);
    expect(starts[0].cwd).toBe("/remote/repo/track");
    expect(store(host).listNodeRuns(id)).toEqual([expect.objectContaining({ status: "done", attempt: 1, childThreadId: null, output: "done" })]);
    expect(host.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
    expect(await host.bb.storage.kv.list("command-job:")).toEqual([]);
  });
  it("reattaches the same attempt and job after reload without stopping it", async () => {
    const { host, starts, finish } = setup({ hold: true });
    const id = await start(host);
    await vi.waitFor(() => expect(starts).toHaveLength(1));
    const firstJob = starts[0].jobId;
    const next = await host.harness.lifecycle.reload(graphStudio);
    hosts.push(next);
    void next.harness.behavior.runService("resume-orphans");
    await vi.waitFor(() => expect(starts).toHaveLength(2));
    expect(starts[1].jobId).toBe(firstJob);
    expect(store(next).listNodeRuns(id)).toHaveLength(1);
    expect(next.harness.inspection.experimental_hostRpcCalls.filter((call) => call.method === "stop")).toHaveLength(0);
    finish();
    await vi.waitFor(() => expect(store(next).getRun(id)?.status).toBe("done"), { timeout: 5000 });
    expect(store(next).listNodeRuns(id)[0]).toMatchObject({ status: "done", attempt: 1 });
  });
  it("reattaches an embedded command without abandoning its open row", async () => {
    const { host, starts, finish } = setup({ hold: true });
    await host.harness.behavior.callRpc("saveGraph", { graph });
    const parent = graphSchema.parse({
      id: "parent", name: "Parent", nodes: [{ id: "child", label: "Child", kind: "subgraph", graphId: graph.id }],
      edges: [{ from: "__start__", to: "child" }, { from: "child", to: "__end__" }],
    });
    const id = await start(host, parent);
    await vi.waitFor(() => expect(starts).toHaveLength(1));
    const next = await host.harness.lifecycle.reload(graphStudio);
    hosts.push(next);
    void next.harness.behavior.runService("resume-orphans");
    await vi.waitFor(() => expect(starts).toHaveLength(2));
    expect(starts[0].jobId).toBe(starts[1].jobId);
    expect(store(next).listNodeRuns(id).filter((row) => row.nodeId === "gate")).toHaveLength(1);
    finish();
    await vi.waitFor(() => expect(store(next).getRun(id)?.status).toBe("done"), { timeout: 5000 });
  });
  it("gives concurrent fan-out commands distinct attempts and resumes both jobs", async () => {
    const { host, starts, finish } = setup({ hold: true });
    const parallel = graphSchema.parse({
      id: "parallel-commands", name: "Parallel commands",
      nodes: [
        { id: "plan", label: "Plan", kind: "command", command: "items", maxAttempts: 1, fields: [{ name: "items", type: "list" }] },
        { id: "work", label: "Work", kind: "command", command: "echo {{item}}", maxAttempts: 1 },
      ],
      edges: [{ from: "__start__", to: "plan" }, { from: "plan", to: "work", fanOutOver: "plan.items" }, { from: "work", to: "__end__" }],
    });
    const id = await start(host, parallel);
    await vi.waitFor(() => expect(starts).toHaveLength(3));
    expect(new Set(starts.map((entry) => entry.jobId)).size).toBe(3);
    const workRows = store(host).listNodeRuns(id).filter((row) => row.nodeId === "work");
    expect(workRows.map((row) => row.attempt).sort()).toEqual([1, 2]);
    const next = await host.harness.lifecycle.reload(graphStudio);
    hosts.push(next);
    void next.harness.behavior.runService("resume-orphans");
    await vi.waitFor(() => expect(starts).toHaveLength(5));
    expect(new Set(starts.map((entry) => entry.jobId)).size).toBe(3);
    finish();
    await vi.waitFor(() => expect(store(next).getRun(id)?.status).toBe("done"), { timeout: 5000 });
    expect(store(next).listNodeRuns(id).filter((row) => row.nodeId === "work")).toHaveLength(2);
  });
  it("sends an explicit stop to the environment host", async () => {
    const { host, starts } = setup({ hold: true });
    const id = await start(host);
    await vi.waitFor(() => expect(starts).toHaveLength(1));
    await host.harness.behavior.callRpc("stopRun", { runId: id });
    await vi.waitFor(() => expect(store(host).getRun(id)?.status).toBe("stopped"));
    expect(host.harness.inspection.experimental_hostRpcCalls).toContainEqual(expect.objectContaining({ method: "stop", input: { jobId: starts[0].jobId }, hostId: "host_vm" }));
  });
  it("does not launch a command if Stop arrives while its environment is resolving", async () => {
    let entered = false;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const { host, starts } = setup({ hold: true, waitForEnvironment: async () => { entered = true; await pending; } });
    const id = await start(host);
    await vi.waitFor(() => expect(entered).toBe(true));
    await host.harness.behavior.callRpc("stopRun", { runId: id });
    release();
    await vi.waitFor(() => expect(store(host).getRun(id)?.status).toBe("stopped"));
    expect(starts).toHaveLength(0);
  });
  it("cancels persisted command jobs when a stopping run resumes after reload", async () => {
    const { host, starts } = setup({ hold: true });
    const id = await start(host);
    await vi.waitFor(() => expect(starts).toHaveLength(1));
    store(host).updateRun(id, { status: "stopping", state: {}, error: null }, Date.now());
    const next = await host.harness.lifecycle.reload(graphStudio);
    hosts.push(next);
    void next.harness.behavior.runService("resume-orphans");
    await vi.waitFor(() => expect(store(next).getRun(id)?.status).toBe("stopped"));
    expect(next.harness.inspection.experimental_hostRpcCalls).toContainEqual(expect.objectContaining({ method: "stop", input: { jobId: starts[0].jobId } }));
    expect(starts).toHaveLength(1);
  });
  it("keeps an offline cancellation stopping until the host accepts it", async () => {
    const { host, starts, fail } = setup({ hold: true });
    const id = await start(host);
    await vi.waitFor(() => expect(starts).toHaveLength(1));
    fail(new Error("host offline"));
    await host.harness.behavior.callRpc("stopRun", { runId: id });
    await vi.waitFor(() => expect(store(host).getRun(id)?.error).toContain("host offline"));
    expect(store(host).getRun(id)?.status).toBe("stopping");
    expect(await host.bb.storage.kv.list(`command-job:${id}:`)).toHaveLength(1);
    fail();
    void host.harness.behavior.runService("resume-orphans");
    await vi.waitFor(() => expect(store(host).getRun(id)?.status).toBe("stopped"));
    expect(await host.bb.storage.kv.list(`command-job:${id}:`)).toEqual([]);
    expect(starts).toHaveLength(1);
  });
  it("does not run a remote directory locally when the host entry is unavailable", async () => {
    const { host } = setup({ failure: Object.assign(new Error("Host entry missing"), { code: "plugin_host_entry_missing" }) });
    const id = await start(host);
    await vi.waitFor(() => expect(store(host).getRun(id)?.status).toBe("failed"));
    expect(store(host).getRun(id)?.error).toContain("Host host_vm");
    expect(host.harness.inspection.sdk.callsTo("system.config")).toHaveLength(1);
  });
  it("allows the same-host local fallback only for a missing entry", async () => {
    const { host } = setup({ hostId: "host_local", failure: Object.assign(new Error("Host entry missing"), { code: "plugin_host_entry_missing" }) });
    const local = structuredClone(graph);
    local.nodes[0].cwd = "/tmp";
    const id = await start(host, local);
    await vi.waitFor(() => expect(store(host).getRun(id)?.status).toBe("done"));
    expect(store(host).listNodeRuns(id)[0].output).toBe("done");
    expect(await host.bb.storage.kv.list("command-job:")).toEqual([]);
  });
  it("does not fall back locally on an offline same-host worker", async () => {
    const { host } = setup({ hostId: "host_local", failure: new Error("host offline") });
    const id = await start(host);
    await vi.waitFor(() => expect(store(host).getRun(id)?.status).toBe("failed"), { timeout: 5000 });
    expect(store(host).getRun(id)?.error).toContain("Host host_local: host offline");
    expect(host.harness.inspection.sdk.callsTo("system.config")).toHaveLength(0);
  });
});
