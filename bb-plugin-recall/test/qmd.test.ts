import { describe, expect, it } from "vitest";
import { cleanSnippet, parseHits, Qmd, QMD_INDEX, type Exec } from "../lib/qmd.js";

describe("parseHits", () => {
  it("parses qmd JSON and strips the diff header", () => {
    const stdout = `noise\n${JSON.stringify([
      { file: "qmd://bb/thread-thr_1.md?index=recall", title: "T", snippet: "@@ -1,2 @@ (0 before, 3 after)\nhello", score: 0.9 },
    ])}`;
    expect(parseHits(stdout)).toEqual([{ file: "qmd://bb/thread-thr_1.md?index=recall", title: "T", snippet: "hello", score: 0.9 }]);
  });

  it("skips entries without a file and tolerates missing fields", () => {
    expect(parseHits(JSON.stringify([{ title: "x" }, { file: "f.md" }]))).toEqual([
      { file: "f.md", title: "", snippet: "", score: 0 },
    ]);
  });

  it("treats a 'no results' notice as empty and other text as an error", () => {
    expect(parseHits("No results found.")).toEqual([]);
    expect(() => parseHits("model download failed")).toThrow();
  });
});

describe("cleanSnippet", () => {
  it("leaves ordinary lines alone", () => {
    expect(cleanSnippet("a @@ b\nc")).toBe("a @@ b\nc");
  });
});

describe("Qmd", () => {
  function recorder(stdout = "[]") {
    const calls: string[][] = [];
    const exec: Exec = async (args) => {
      calls.push(args);
      return { stdout, stderr: "" };
    };
    return { calls, qmd: new Qmd(exec) };
  }

  it("always passes its own named index so the user's index stays untouched", async () => {
    const { calls, qmd } = recorder();
    await qmd.search("q", "fast", 5);
    await qmd.update();
    await qmd.embed();
    for (const args of calls) expect(args.slice(0, 2)).toEqual(["--index", QMD_INDEX]);
  });

  it("uses BM25 for fast and hybrid query for smart", async () => {
    const { calls, qmd } = recorder();
    await qmd.search("q", "fast", 5);
    await qmd.search("q", "smart", 5);
    expect(calls[0][2]).toBe("search");
    expect(calls[1][2]).toBe("query");
  });

  it("adds the collection only when it is missing", async () => {
    const present = recorder("Collections (1):\n\nbb (qmd://bb/)\n");
    await present.qmd.ensureCollection("/m");
    expect(present.calls).toHaveLength(1);
    const missing = recorder("Collections (0):\n");
    await missing.qmd.ensureCollection("/m");
    expect(missing.calls[1]).toEqual(["--index", QMD_INDEX, "collection", "add", "/m", "--name", "bb"]);
  });

  it("reports availability from the exit of --help", async () => {
    expect(await new Qmd(async () => ({ stdout: "", stderr: "" })).available()).toBe(true);
    expect(await new Qmd(async () => { throw new Error("ENOENT"); }).available()).toBe(false);
  });
});
