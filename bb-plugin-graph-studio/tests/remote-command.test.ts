import { describe, expect, it, vi } from "vitest";
import { commandJobId, hostEntryUnavailable, runRemoteCommand, type CommandClient } from "../lib/remote-command";
import type { JobPoll } from "../contract";

const jobId = commandJobId("run", "node", 1, 1);
const input = { jobId, command: "echo ok", cwd: "/tmp", timeoutMs: 90 * 60_000, hostId: "host_vm", pollMs: 1 };
const running: JobPoll = { state: "running", exitCode: null, stdoutTail: "progress", stderrTail: "", nextOffset: 8 };
const exited: JobPoll = { state: "exited", exitCode: 0, stdoutTail: "ok", stderrTail: "", nextOffset: 10 };
function fake(polls: Array<JobPoll | Error>) {
  const call = vi.fn(async (method: string) => {
    if (method === "start") return { started: true };
    if (method === "stop") return { stopped: true };
    const poll = polls.shift() ?? exited;
    if (poll instanceof Error) throw poll;
    return poll;
  });
  return { call, client: { call } as unknown as CommandClient };
}

describe("remote command identity", () => {
  it("is stable and separates tuple boundaries", () => {
    expect(commandJobId("run", "node", 1, 1)).toBe(jobId);
    expect(commandJobId("ru", "nnode", 1, 1)).not.toBe(jobId);
  });
  it.each([
    ["other", "node", 1, 1, 0], ["run", "other", 1, 1, 0],
    ["run", "node", 2, 1, 0], ["run", "node", 1, 2, 0], ["run", "node", 1, 1, 1],
  ] as const)("changes for identity %s/%s/%s/%s/%s", (run, node, visit, attempt, generation) => {
    expect(commandJobId(run, node, visit, attempt, generation)).not.toBe(jobId);
  });
});

describe("host command polling", () => {
  it("polls running to exited with the targeted host and full command deadline", async () => {
    const f = fake([running, exited]);
    expect(await runRemoteCommand({ ...input, client: f.client })).toEqual({ exitCode: 0, stdout: "ok", stderr: "" });
    expect(f.call.mock.calls[0]).toEqual(["start", { jobId, command: input.command, cwd: "/tmp", timeoutMs: input.timeoutMs }, expect.objectContaining({ hostId: "host_vm", timeoutMs: 15_000 })]);
    expect(f.call.mock.calls[2][1]).toEqual({ jobId, since: 8 });
    expect(f.call.mock.calls.some(([method]) => method === "stop")).toBe(false);
  });
  it.each([2, 124])("returns command exit %s without treating it as a transport error", async (code) => {
    const f = fake([{ ...exited, exitCode: code, stderrTail: "failure" }]);
    expect(await runRemoteCommand({ ...input, client: f.client })).toEqual({ exitCode: code, stdout: "ok", stderr: "Host host_vm: failure" });
    expect(f.call).toHaveBeenCalledTimes(2);
  });
  it("reports a missing helper in one line naming the host", async () => {
    const f = fake([{ ...exited, exitCode: 127, stderrTail: "bash: .bb/helper.sh: No such file or directory\nmore output" }]);
    await expect(runRemoteCommand({ ...input, client: f.client })).rejects.toThrow("Host host_vm: bash: .bb/helper.sh: No such file or directory");
    expect(f.call).toHaveBeenCalledTimes(2);
  });
  it("preserves an intentional exit 127 without a missing-command diagnostic", async () => {
    const f = fake([{ ...exited, exitCode: 127, stderrTail: "custom result" }]);
    expect((await runRemoteCommand({ ...input, client: f.client })).exitCode).toBe(127);
  });
  it("reattaches to a job that already finished", async () => {
    const f = fake([exited]);
    await runRemoteCommand({ ...input, client: f.client });
    expect(f.call).toHaveBeenCalledTimes(2);
  });
  it("recovers from a lost poll response", async () => {
    const f = fake([new Error("connection lost"), exited]);
    expect((await runRemoteCommand({ ...input, client: f.client })).exitCode).toBe(0);
    expect(f.call.mock.calls.filter(([method]) => method === "start")).toHaveLength(1);
  });
  it("retries a lost start response with the same identity", async () => {
    const f = fake([exited]);
    f.call.mockRejectedValueOnce(new Error("response lost"));
    await runRemoteCommand({ ...input, client: f.client });
    expect(f.call.mock.calls[0]).toEqual(f.call.mock.calls[1]);
  });
  it("reports a persistent host failure with the host name and one line", async () => {
    const f = fake([new Error("host offline\nstack trace"), new Error("host offline\nstack trace")]);
    await expect(runRemoteCommand({ ...input, client: f.client })).rejects.toThrow("Host host_vm: host offline");
  });
  it("does not restart a job whose saved state is unknown", async () => {
    const f = fake([{ ...running, state: "unknown" }]);
    await expect(runRemoteCommand({ ...input, client: f.client })).rejects.toThrow(/host_vm.*saved command job/);
    expect(f.call).toHaveBeenCalledTimes(2);
  });
  it("rejects an exited job without an exit code", async () => {
    const f = fake([{ ...exited, exitCode: null }]);
    await expect(runRemoteCommand({ ...input, client: f.client })).rejects.toThrow(/without an exit code/);
  });
  it.each([true, false])("on abort kills the job only for explicit stop=%s", async (stop) => {
    const controller = new AbortController();
    const f = fake([running]);
    f.call.mockImplementation(async (method: string) => {
      if (method === "start") return { started: true };
      if (method === "stop") return { stopped: true };
      controller.abort();
      return running;
    });
    await expect(runRemoteCommand({ ...input, client: f.client, signal: controller.signal, shouldStop: () => stop })).rejects.toThrow();
    const calls = f.call.mock.calls.filter(([method]) => method === "stop");
    expect(calls).toHaveLength(stop ? 1 : 0);
    if (stop) expect(calls[0][2]).not.toHaveProperty("signal");
  });
  it("does not start a job when already aborted", async () => {
    const f = fake([]);
    await expect(runRemoteCommand({ ...input, client: f.client, signal: AbortSignal.abort(), shouldStop: () => false })).rejects.toThrow();
    expect(f.call).not.toHaveBeenCalled();
  });
  it("reports stop failures rather than silently leaving work running", async () => {
    const f = fake([]);
    f.call.mockRejectedValue(new Error("offline"));
    await expect(runRemoteCommand({ ...input, client: f.client, signal: AbortSignal.abort() })).rejects.toThrow(/host_vm.*Could not stop/);
  });
  it("recognizes only explicit missing-entry errors for fallback", () => {
    expect(hostEntryUnavailable({ code: "plugin_host_entry_missing" })).toBe(true);
    expect(hostEntryUnavailable(new Error("offline"))).toBe(false);
    expect(hostEntryUnavailable({ code: "timeout" })).toBe(false);
    expect(hostEntryUnavailable(null)).toBe(false);
  });
});
