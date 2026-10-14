import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { isAbsolute, join } from "node:path";
import { jobIdSchema, jobPollSchema, startJobSchema, type JobPoll, type StartJob } from "../contract";
import { COMMAND_SUPERVISOR_SOURCE } from "./command-supervisor";

const empty: JobPoll = { state: "unknown", exitCode: null, stdoutTail: "", stderrTail: "", nextOffset: 0 };

export function createHostJobs(dataDir: string) {
  const jobs = join(dataDir, "jobs");
  const directory = (jobId: string) => join(jobs, jobIdSchema.parse(jobId));
  return {
    async start(input: StartJob): Promise<{ started: true }> {
      const args = startJobSchema.parse(input);
      const dir = directory(args.jobId);
      const request = JSON.stringify(args);
      if (existsSync(dir)) {
        if (existsSync(join(dir, "stop"))) {
          throw new Error(`Host ${hostname()}: the command job was stopped.`);
        }
        if (readFileSync(join(dir, "request.json"), "utf8") !== request) {
          throw new Error(`Host ${hostname()}: command job identity conflicts with its saved request.`);
        }
        return { started: true };
      }
      if (!isAbsolute(args.cwd) || !existsSync(args.cwd) || !statSync(args.cwd).isDirectory()) {
        throw new Error(`Host ${hostname()}: command directory does not exist: ${args.cwd}`);
      }
      if (spawnSync("bash", ["-lc", "exit 0"]).status !== 0) {
        throw new Error(`Host ${hostname()}: bash is missing or cannot start.`);
      }
      mkdirSync(jobs, { recursive: true });
      // mkdir is the cross-worker claim. A partial claim is never restarted:
      // failing visibly is safer than executing a side effect twice.
      mkdirSync(dir);
      writeFileSync(join(dir, "request.json"), request);
      const script = join(dir, "supervisor.cjs");
      writeFileSync(script, COMMAND_SUPERVISOR_SOURCE);
      // BB's packaged Bun executable needs this flag to execute a script
      // rather than entering its compiled CLI again. Node ignores the env var.
      const child = spawn(process.execPath, [script, dir], {
        detached: true, stdio: "ignore", env: { ...process.env, BUN_BE_BUN: "1" },
      });
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", resolve);
      });
      child.unref();
      return { started: true };
    },
    poll({ jobId, since }: { jobId: string; since: number }): JobPoll {
      const dir = directory(jobId);
      if (!existsSync(dir)) return { ...empty };
      const snapshot = join(dir, "snapshot.json");
      if (!existsSync(snapshot)) {
        if (!existsSync(join(dir, "request.json"))) return { ...empty };
        return Date.now() - statSync(dir).mtimeMs < 10_000
          ? { ...empty, state: "running" } : { ...empty };
      }
      const saved = jobPollSchema.parse(JSON.parse(readFileSync(snapshot, "utf8")));
      if (saved.state === "running" && Date.now() - statSync(snapshot).mtimeMs > 30_000) {
        return { ...saved, state: "unknown" };
      }
      // Tails are snapshots, never deltas; the caller replaces its cache.
      // Equal offsets suppress unchanged running output, but exited jobs must
      // always return their final tails to a driver reattaching at any offset.
      return saved.state === "running" && since === saved.nextOffset
        ? { ...saved, stdoutTail: "", stderrTail: "" } : saved;
    },
    stop({ jobId }: { jobId: string }): { stopped: boolean } {
      const dir = directory(jobId);
      if (existsSync(dir) && this.poll({ jobId, since: 0 }).state === "exited") return { stopped: false };
      const known = existsSync(dir);
      // A file belongs to this job forever; signalling a saved PID could kill
      // an unrelated process after the OS reuses it.
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "stop"), "");
      return { stopped: known };
    },
    ping() {
      const has = (name: string) => spawnSync("bash", ["-lc", `command -v ${name}`]).status === 0;
      return { hostname: hostname(), bash: has("bash"), jq: has("jq"), git: has("git"), bun: has("bun"), gh: has("gh") };
    },
  };
}
