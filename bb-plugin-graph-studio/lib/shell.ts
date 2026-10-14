// Running a command node's shell command.
//
// The plugin server runs on the machine BB itself runs on, so a command for a
// local environment can be spawned right here. A command for an environment
// on another host has nowhere to run yet — that needs a `bb.host` entry on
// that host — and is refused by the caller instead of running against a path
// that does not exist on this machine.
import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";

export type ShellResult = { exitCode: number; stdout: string; stderr: string };

/**
 * What one stream may hold. A Turbo gate can print megabytes; the node only
 * needs the end of it (the JSON result, the failing step's tail), so the
 * front is dropped rather than held in memory.
 */
const STREAM_LIMIT = 256 * 1024;

/** Exit code for a command killed by its timeout, as `timeout(1)` reports it. */
export const TIMEOUT_EXIT = 124;

function keepTail(text: string): string {
  return text.length > STREAM_LIMIT ? text.slice(text.length - STREAM_LIMIT) : text;
}

/**
 * Run `command` with `bash -lc` in `cwd` and resolve with its exit code and
 * output. Never rejects for a non-zero exit — that is the command's answer.
 * Rejects when bash cannot be started, and when `signal` aborts (the run was
 * stopped): the whole process group is killed then, because a gate's
 * `bunx turbo` children would otherwise outlive the run.
 */
export function runShell(args: {
  command: string;
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ShellResult> {
  return new Promise((resolvePromise, reject) => {
    if (args.signal?.aborted) {
      reject(new Error("The command was stopped before it started."));
      return;
    }
    const child = spawn("bash", ["-lc", args.command], {
      cwd: args.cwd,
      // Its own process group, so a kill reaches everything it started.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = keepTail(stdout + chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = keepTail(stderr + chunk);
    });

    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, args.timeoutMs);
    const onAbort = () => killGroup();
    args.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      args.signal?.removeEventListener("abort", onAbort);
      outcome();
    };
    child.on("error", (cause) => finish(() => reject(cause)));
    child.on("close", (code, signalName) => {
      finish(() => {
        if (args.signal?.aborted) {
          reject(new Error("The command was stopped."));
          return;
        }
        if (timedOut) {
          resolvePromise({
            exitCode: TIMEOUT_EXIT,
            stdout,
            stderr: `${stderr}\nKilled after ${Math.round(args.timeoutMs / 60_000)} min.`,
          });
          return;
        }
        resolvePromise({
          exitCode: code ?? (signalName ? 128 : 1),
          stdout,
          stderr,
        });
      });
    });
  });
}

/**
 * A node's directory, made absolute against the environment's root. A
 * relative path is the normal case — `.worktrees/arc-4/arc-5` — because the
 * graph should not know where the repository sits on this machine.
 */
export function resolveIn(root: string, path: string | null): string {
  if (path === null || path.trim() === "") return root;
  return isAbsolute(path) ? path : resolve(root, path);
}
