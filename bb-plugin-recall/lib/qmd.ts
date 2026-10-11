// Thin adapter around the qmd CLI.
//
// Recall keeps its own named qmd index ("--index recall"): collections and the
// SQLite index live beside the user's default index without touching it, while
// the downloaded models stay shared. Without the flag a `collection add` would
// land in the user's global qmd config.

import { execFile } from "node:child_process";

export const QMD_INDEX = "recall";
export const QMD_COLLECTION = "bb";

export type QmdMode = "fast" | "smart";

export interface QmdHit {
  file: string;
  title: string;
  snippet: string;
  score: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type Exec = (
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal },
) => Promise<ExecResult>;

export function nodeExec(binary = "qmd"): Exec {
  return (args, { timeoutMs, signal }) =>
    new Promise((resolve, reject) => {
      execFile(
        binary,
        args,
        { timeout: timeoutMs, signal, maxBuffer: 32 * 1024 * 1024, env: process.env },
        (error, stdout, stderr) => {
          if (error) reject(Object.assign(error, { stderr: String(stderr) }));
          else resolve({ stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
}

/** qmd prints a diff-style "@@ -3,4 @@ (2 before, 5 after)" header first. */
export function cleanSnippet(snippet: string): string {
  return snippet
    .split("\n")
    .filter((line) => !/^@@ .* @@/.test(line))
    .join("\n")
    .trim();
}

/** Parses `qmd search|query --json`; anything malformed yields an error, not hits. */
export function parseHits(stdout: string): QmdHit[] {
  const start = stdout.indexOf("[");
  if (start === -1) {
    // qmd prints a plain notice instead of JSON when nothing matched.
    if (/no results/i.test(stdout)) return [];
    throw new Error("qmd returned no JSON");
  }
  const raw: unknown = JSON.parse(stdout.slice(start));
  if (!Array.isArray(raw)) throw new Error("qmd JSON is not a list");
  return raw.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.file !== "string") return [];
    return [
      {
        file: record.file,
        title: typeof record.title === "string" ? record.title : "",
        snippet: typeof record.snippet === "string" ? cleanSnippet(record.snippet) : "",
        score: typeof record.score === "number" ? record.score : 0,
      },
    ];
  });
}

export class Qmd {
  constructor(private readonly exec: Exec) {}

  private run(args: string[], timeoutMs: number, signal?: AbortSignal) {
    return this.exec(["--index", QMD_INDEX, ...args], { timeoutMs, signal });
  }

  async available(): Promise<boolean> {
    try {
      await this.exec(["--help"], { timeoutMs: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  async listCollections(): Promise<string[]> {
    const { stdout } = await this.run(["collection", "list"], 30_000);
    return [...stdout.matchAll(/qmd:\/\/([^/\s]+)\//g)].map((match) => match[1]);
  }

  /**
   * Makes the index hold exactly the wanted collections among those Recall
   * owns; a collection outside `owns` (never the case with a named index,
   * but cheap to guard) is left alone.
   */
  async syncCollections(
    wanted: readonly { name: string; dir: string }[],
    owns: (name: string) => boolean,
  ): Promise<void> {
    const present = new Set(await this.listCollections());
    for (const { name, dir } of wanted) {
      if (!present.has(name)) await this.run(["collection", "add", dir, "--name", name], 120_000);
    }
    const keep = new Set(wanted.map((entry) => entry.name));
    for (const name of present) {
      if (owns(name) && !keep.has(name)) await this.run(["collection", "remove", name], 120_000);
    }
  }

  /** Registers the mirror directory once; a second add would fail, so list first. */
  async ensureCollection(dir: string): Promise<void> {
    await this.syncCollections([{ name: QMD_COLLECTION, dir }], () => false);
  }

  async update(signal?: AbortSignal): Promise<void> {
    await this.run(["update"], 10 * 60_000, signal);
  }

  async embed(signal?: AbortSignal): Promise<void> {
    await this.run(["embed"], 60 * 60_000, signal);
  }

  async search(
    query: string,
    mode: QmdMode,
    limit: number,
    signal?: AbortSignal,
    collections: readonly string[] = [QMD_COLLECTION],
  ): Promise<QmdHit[]> {
    const command = mode === "fast" ? "search" : "query";
    // Smart mode loads models on its first call; the generous limit covers that cold start.
    const timeoutMs = mode === "fast" ? 15_000 : 180_000;
    const { stdout } = await this.run(
      [command, query, "-n", String(limit), ...collections.flatMap((name) => ["-c", name]), "--json"],
      timeoutMs,
      signal,
    );
    return parseHits(stdout);
  }
}
