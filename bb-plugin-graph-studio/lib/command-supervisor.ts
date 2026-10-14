// Kept as JavaScript source: the detached supervisor must survive removal of
// its host bundle, and build-time name helpers cannot leak into its scope.
export const COMMAND_SUPERVISOR_SOURCE = String.raw`
const fs = require("node:fs");
const { join } = require("node:path");
const { spawn } = require("node:child_process");
  const directory = process.argv[2];
  const args = JSON.parse(fs.readFileSync(join(directory, "request.json"), "utf8"));
  const limit = 256 * 1024;
  let stdoutTail = "";
  let stderrTail = "";
  let nextOffset = 0;
  let timedOut = false;
  let stopped = false;
  let settled = false;
  let savedOffset = -1;
  const save = (state, exitCode) => {
    if (state === "running" && savedOffset === nextOffset) {
      // Refresh liveness without rewriting an unchanged large output tail.
      const now = new Date();
      fs.utimesSync(join(directory, "snapshot.json"), now, now);
      return;
    }
    const temporary = join(directory, "snapshot.tmp");
    fs.writeFileSync(temporary, JSON.stringify({
      state, exitCode, stdoutTail, stderrTail, nextOffset,
    }));
    fs.renameSync(temporary, join(directory, "snapshot.json"));
    savedOffset = nextOffset;
  };
  const child = spawn("bash", ["-lc", args.command], {
    cwd: args.cwd, detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  fs.writeFileSync(join(directory, "process.json"), JSON.stringify({
    supervisorPid: process.pid, processGroupId: child.pid ?? null,
    startedAt: Date.now(), timeoutMs: args.timeoutMs,
  }));
  const kill = () => {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already gone. */ }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    nextOffset += chunk.length;
    stdoutTail = (stdoutTail + chunk).slice(-limit);
  });
  child.stderr.on("data", (chunk) => {
    nextOffset += chunk.length;
    stderrTail = (stderrTail + chunk).slice(-limit);
  });
  save("running", null);
  const started = Date.now();
  const tick = setInterval(() => {
    if (Date.now() - started >= args.timeoutMs) timedOut = true;
    if (fs.existsSync(join(directory, "stop"))) stopped = true;
    if (stopped || timedOut) kill();
    save("running", null);
  }, 100);
  const finish = (code) => {
    if (settled) return;
    settled = true;
    clearInterval(tick);
    // A successful shell can leave background children behind, too.
    kill();
    if (timedOut) stderrTail = (stderrTail + "\nKilled after the command time limit.").slice(-limit);
    if (stopped) stderrTail = (stderrTail + "\nThe command was stopped.").slice(-limit);
    save("exited", timedOut ? 124 : stopped ? 137 : code);
  };
  child.on("error", (error) => {
    stderrTail = error.message;
    finish(127);
  });
  // exit precedes close; kill inherited pipe holders so close can arrive.
  child.on("exit", kill);
  child.on("close", (code) => finish(code ?? 128));
`;
