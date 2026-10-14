import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ExperimentalHostClient } from "@get-bb/plugin-sdk";
import type { hostContract, StartJob } from "../contract";
import { CommandJobUncertain, type ShellResult } from "./shell";

export type CommandClient = Pick<ExperimentalHostClient<typeof hostContract>, "call">;

export function commandJobId(runId: string, nodeId: string, visit: number, attempt: number, generation = 0): string {
  // JSON preserves tuple boundaries; checkpoint reruns deliberately get new jobs.
  return createHash("sha256").update(JSON.stringify([runId, nodeId, visit, attempt, generation])).digest("hex");
}

export function hostCommandError(hostId: string, cause: unknown): Error {
  const message = (cause instanceof Error ? cause.message : String(cause)).split("\n")[0];
  return new Error(`Host ${hostId}: ${message}`);
}

/** Only an explicit missing entry can justify the same-host local fallback. */
export function hostEntryUnavailable(cause: unknown): boolean {
  const code = (cause as { code?: string } | null)?.code;
  return code === "plugin_host_entry_missing" || code === "host_entry_not_found";
}

export async function runRemoteCommand(args: StartJob & {
  client: CommandClient;
  hostId: string;
  signal?: AbortSignal;
  /** Losing a driver relinquishes the wait; only an explicit run stop kills work. */
  shouldStop?: () => boolean;
  pollMs?: number;
}): Promise<ShellResult> {
  const { client, hostId, signal } = args;
  const options = { hostId, signal, timeoutMs: 15_000 };
  const request: StartJob = { jobId: args.jobId, command: args.command, cwd: args.cwd, timeoutMs: args.timeoutMs };
  const wait = () => delay(args.pollMs ?? 2000, undefined, { signal });
  const call = async <T>(operation: () => Promise<T>): Promise<T> => {
    try { return await operation(); } catch (cause) {
      if (signal?.aborted || hostEntryUnavailable(cause)) throw cause;
      // A lost response may have followed a successful start. Retrying the
      // same job is safe, while retrying the command with a new id is not.
      await wait();
      return operation();
    }
  };
  try {
    signal?.throwIfAborted();
    await call(() => client.call("start", request, options));
    let since = 0;
    for (;;) {
      signal?.throwIfAborted();
      const poll = await call(() => client.call("poll", { jobId: args.jobId, since }, options));
      if (poll.state === "exited") {
        if (poll.exitCode === null) throw new Error("The command finished without an exit code.");
        if (poll.exitCode === 127 && /No such file or directory|command not found/.test(poll.stderrTail)) {
          throw new Error(poll.stderrTail.trim().split("\n")[0]);
        }
        return {
          exitCode: poll.exitCode, stdout: poll.stdoutTail,
          stderr: poll.exitCode === 0 ? poll.stderrTail : `Host ${hostId}: ${poll.stderrTail}`,
        };
      }
      if (poll.state === "unknown") throw new Error("The saved command job is unavailable; inspect it before retrying.");
      since = poll.nextOffset;
      // The host supervisor owns the deadline, so a reattached driver never
      // resets the command's time limit and network latency cannot extend it.
      await wait();
    }
  } catch (cause) {
    if (signal?.aborted && (args.shouldStop?.() ?? true)) {
      // The cancelled signal must not cancel the cleanup RPC itself.
      try {
        await client.call("stop", { jobId: args.jobId }, { hostId, timeoutMs: 15_000 });
      } catch (stopCause) {
        throw hostCommandError(hostId, `Could not stop command ${args.jobId}: ${stopCause instanceof Error ? stopCause.message : String(stopCause)}`);
      }
    }
    if (hostEntryUnavailable(cause)) throw cause;
    throw new CommandJobUncertain(hostCommandError(hostId, cause).message);
  }
}
