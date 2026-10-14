import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import hostEntry from "../host";
import { commandJobId } from "../lib/remote-command";
import { createHostJobs } from "../lib/host-jobs";

const directories: string[] = [];
const active: Array<{ jobs: ReturnType<typeof createHostJobs>; jobId: string }> = [];
afterEach(async () => {
  for (const { jobs, jobId } of active.splice(0)) {
    jobs.stop({ jobId });
    await vi.waitFor(() => expect(jobs.poll({ jobId, since: 0 }).state).not.toBe("running"), { timeout: 5000 });
  }
  vi.unstubAllEnvs();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup(command = "printf ok", timeoutMs = 5000) {
  const dir = mkdtempSync(join(tmpdir(), "gs-host-"));
  directories.push(dir);
  const jobs = createHostJobs(dir);
  const jobId = commandJobId(dir, "gate", 1, 1);
  active.push({ jobs, jobId });
  return { jobs, dir, input: { jobId, command, cwd: dir, timeoutMs } };
}
async function finished(jobs: ReturnType<typeof createHostJobs>, jobId: string) {
  await vi.waitFor(() => expect(jobs.poll({ jobId, since: 0 }).state).toBe("exited"), { timeout: 10_000 });
  return jobs.poll({ jobId, since: 0 });
}

describe("durable host jobs", () => {
  it("runs real bash, retains the exit code and both streams", async () => {
    const { jobs, input, dir } = setup("printf ok; printf problem >&2; exit 7");
    expect(await jobs.start(input)).toEqual({ started: true });
    expect(await finished(jobs, input.jobId)).toMatchObject({ exitCode: 7, stdoutTail: "ok", stderrTail: "problem" });
    const processInfo = JSON.parse(readFileSync(join(dir, "jobs", input.jobId, "process.json"), "utf8"));
    expect(processInfo.supervisorPid).toBeGreaterThan(0);
    expect(processInfo.processGroupId).toBeGreaterThan(0);
    expect(jobs.stop(input)).toEqual({ stopped: false });
  });
  it("caps memory and disk tails, retaining the last output", async () => {
    const { jobs, dir, input } = setup("head -c 400000 /dev/zero | tr '\\0' x; printf END; head -c 400000 /dev/zero | tr '\\0' y >&2");
    await jobs.start(input);
    const poll = await finished(jobs, input.jobId);
    expect(poll.stdoutTail).toHaveLength(256 * 1024);
    expect(poll.stderrTail).toHaveLength(256 * 1024);
    expect(poll.stdoutTail.endsWith("END")).toBe(true);
    expect(poll.nextOffset).toBe(800003);
    expect(statSync(join(dir, "jobs", input.jobId, "snapshot.json")).size).toBeLessThan(530000);
  });
  it("reattaches from a fresh instance without running the side effect twice", async () => {
    const { jobs, dir, input } = setup("printf x >> count; sleep 0.4; printf result");
    await jobs.start(input);
    const next = createHostJobs(dir);
    await next.start(input);
    expect(await finished(next, input.jobId)).toMatchObject({ stdoutTail: "result", exitCode: 0 });
    await next.start(input);
    expect(readFileSync(join(dir, "count"), "utf8")).toBe("x");
  });
  it("rejects a changed request for the same job", async () => {
    const { jobs, input } = setup();
    await jobs.start(input);
    await expect(jobs.start({ ...input, command: "printf other" })).rejects.toThrow(/identity conflicts/);
  });
  it("reports timeout and kills shell descendants", async () => {
    const { jobs, input, dir } = setup("sleep 30 & echo $! > child; wait", 300);
    await jobs.start(input);
    expect((await finished(jobs, input.jobId)).exitCode).toBe(124);
    const child = Number(readFileSync(join(dir, "child"), "utf8"));
    expect(() => process.kill(child, 0)).toThrow();
  });
  it("stops a process group through a fresh handler instance", async () => {
    const { jobs, input, dir } = setup("sleep 30 & echo $! > child; wait");
    await jobs.start(input);
    await vi.waitFor(() => expect(readFileSync(join(dir, "child"), "utf8")).toMatch(/\d/));
    expect(createHostJobs(dir).stop(input)).toEqual({ stopped: true });
    expect((await finished(jobs, input.jobId)).exitCode).toBe(137);
    expect(() => process.kill(Number(readFileSync(join(dir, "child"), "utf8")), 0)).toThrow();
  });
  it("returns unknown for missing jobs, and does not stop unrelated work", () => {
    const { jobs, input } = setup();
    expect(jobs.poll({ ...input, since: 0 }).state).toBe("unknown");
    expect(jobs.stop(input)).toEqual({ stopped: false });
  });
  it("reports missing cwd on the host before launching anything", async () => {
    const { jobs, input } = setup();
    await expect(jobs.start({ ...input, cwd: join(input.cwd, "missing") })).rejects.toThrow(/Host .*directory does not exist/);
    expect(jobs.poll({ ...input, since: 0 }).state).toBe("unknown");
  });
  it("reports missing bash on the host and reports absent tools in ping", async () => {
    const { jobs, input, dir } = setup();
    vi.stubEnv("PATH", dir);
    await expect(jobs.start(input)).rejects.toThrow(/Host .*bash is missing/);
    expect(jobs.ping()).toMatchObject({ bash: false, git: false, jq: false, bun: false, gh: false });
  });
  it("a stop tombstone prevents a delayed start from launching work", async () => {
    const { jobs, input } = setup();
    expect(jobs.stop(input)).toEqual({ stopped: false });
    await expect(jobs.start(input)).rejects.toThrow(/job was stopped/);
    expect(jobs.poll({ ...input, since: 0 }).state).toBe("unknown");
  });
  it("refuses path traversal and invalid command deadlines", async () => {
    const { jobs, input } = setup();
    await expect(jobs.start({ ...input, jobId: "../escape" })).rejects.toThrow();
    await expect(jobs.start({ ...input, timeoutMs: 0 })).rejects.toThrow();
  });
  it("keeps completed tails even at an equal offset", async () => {
    const { jobs, input } = setup();
    await jobs.start(input);
    const poll = await finished(jobs, input.jobId);
    expect(jobs.poll({ jobId: input.jobId, since: poll.nextOffset }).stdoutTail).toBe("ok");
  });
  it("suppresses unchanged running tails and detects a stale supervisor", async () => {
    const { jobs, input, dir } = setup("printf progress; sleep 2");
    await jobs.start(input);
    await vi.waitFor(() => expect(jobs.poll({ jobId: input.jobId, since: 0 }).stdoutTail).toBe("progress"));
    expect(jobs.poll({ jobId: input.jobId, since: 8 }).stdoutTail).toBe("");
    const snapshot = join(dir, "jobs", input.jobId, "snapshot.json");
    utimesSync(snapshot, 0, 0);
    expect(jobs.poll({ jobId: input.jobId, since: 0 }).state).toBe("unknown");
    // Its next heartbeat restores the state; a stale snapshot never restarts work.
    await vi.waitFor(() => expect(jobs.poll({ jobId: input.jobId, since: 0 }).state).toBe("running"));
  });
  it("keeps the detached job alive across host worker disposal without duplicate leases", async () => {
    const { jobs, dir, input } = setup("printf x >> count; sleep 0.7; printf finished");
    const options = { experimental_paths: { dataDir: dir, tempDir: dir } };
    const first = experimental_createHostEntryHarness(hostEntry, options);
    await first.experimental_call("start", input);
    await first.experimental_call("start", input);
    expect(first.experimental_getRetainedWorkerLeaseCount()).toBe(1);
    await first.experimental_dispose();
    expect(first.experimental_getRetainedWorkerLeaseCount()).toBe(0);
    const next = experimental_createHostEntryHarness(hostEntry, options);
    try {
      await next.experimental_call("start", input);
      expect(next.experimental_getRetainedWorkerLeaseCount()).toBe(1);
      expect((await finished(jobs, input.jobId)).stdoutTail).toBe("finished");
      expect(readFileSync(join(dir, "count"), "utf8")).toBe("x");
    } finally { await next.experimental_dispose(); }
  });
  it("round-trips the host contract and holds a worker lease until exit", async () => {
    const { dir, input } = setup("sleep 0.2; printf hello");
    const harness = experimental_createHostEntryHarness(hostEntry, { experimental_paths: { dataDir: dir, tempDir: dir } });
    try {
      expect((await harness.experimental_call("ping", {})).bash).toBe(true);
      await expect(harness.experimental_call("poll", { jobId: "../bad", since: 0 })).rejects.toThrow();
      await expect(harness.experimental_call("poll", { jobId: input.jobId, since: -1 })).rejects.toThrow();
      expect(await harness.experimental_call("start", input)).toEqual({ started: true });
      expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(1);
      await vi.waitFor(async () => expect((await harness.experimental_call("poll", { jobId: input.jobId, since: 0 })).state).toBe("exited"));
      await vi.waitFor(() => expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0), { timeout: 3000 });
    } finally { await harness.experimental_dispose(); }
  });
});
