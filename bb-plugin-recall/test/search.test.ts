import { describe, expect, it } from "vitest";
import { buildCatalog, combine, hitsFromKeyword, hitsFromQmd, parseQmdFile, type FolderInfo } from "../lib/search.js";
import { pathResolver } from "../lib/folders.js";

const folder: FolderInfo = {
  collection: "folder-brain",
  root: "/Users/me/brain",
  label: "brain",
  resolve: pathResolver(["90 Wiki/quellen/service docs.md", "top.md"]),
};
const catalog = buildCatalog(
  new Map([
    ["thr_1", { title: "Search ideas", projectName: "bb-plugins", updatedAt: 5 }],
    ["t1", { title: "Kw", projectName: null, updatedAt: 1 }],
  ]),
  new Map([
    ["01M", { key: "BBP-1", title: "Build recall", status: "in_review", updatedAt: 7 }],
    ["x", { key: "BBP-2", title: "Other", status: "weird", updatedAt: 0 }],
  ]),
  [folder],
);

describe("parseQmdFile", () => {
  it("splits collection and decoded path", () => {
    expect(parseQmdFile("qmd://bb/thread-a.md?index=recall")).toEqual({ collection: "bb", path: "thread-a.md" });
    expect(parseQmdFile("qmd://folder-x/a%20b.md")).toEqual({ collection: "folder-x", path: "a b.md" });
  });

  it("rejects anything that is not a qmd URL", () => {
    expect(parseQmdFile("/tmp/a.md")).toBeNull();
  });
});

describe("hitsFromQmd", () => {
  it("restores real ids and describes threads and tasks", () => {
    const hits = hitsFromQmd(
      [
        // qmd reports "thr_1" as "thr-1".
        { file: "qmd://bb/thread-thr-1.md?index=recall", title: "x", snippet: "**bold** text", score: 1 },
        { file: "qmd://bb/task-01M.md", title: "BBP-1 Build recall", snippet: "", score: 1 },
      ],
      catalog,
    );
    expect(hits[0]).toMatchObject({
      key: "thread:thr_1",
      title: "Search ideas",
      source: "Thread",
      context: "bb-plugins",
      updatedAt: 5,
      snippet: "bold text",
    });
    expect(hits[1]).toMatchObject({ key: "task:01M", title: "Build recall", source: "Task", context: "BBP-1 · In review" });
  });

  it("maps folder hits back to real paths and labels them with the folder", () => {
    const [hit] = hitsFromQmd(
      [{ file: "qmd://folder-brain/90-Wiki/quellen/service-docs.md", title: "Service docs", snippet: "", score: 1 }],
      catalog,
    );
    expect(hit).toMatchObject({
      kind: "file",
      id: "/Users/me/brain/90 Wiki/quellen/service docs.md",
      source: "brain",
      context: "90 Wiki/quellen",
    });
    const [top] = hitsFromQmd([{ file: "qmd://folder-brain/top.md", title: "", snippet: "", score: 1 }], catalog);
    expect(top).toMatchObject({ title: "top.md", context: null });
  });

  it("keeps an unknown task status readable instead of dropping it", () => {
    const [hit] = hitsFromQmd([{ file: "qmd://bb/task-x.md", title: "", snippet: "", score: 1 }], catalog);
    expect(hit.context).toBe("BBP-2 · weird");
  });

  it("drops unknown collections, unknown files and objects that are gone", () => {
    expect(
      hitsFromQmd(
        [
          { file: "qmd://brain/notes.md", title: "", snippet: "", score: 1 },
          { file: "qmd://folder-brain/missing.md", title: "", snippet: "", score: 1 },
          { file: "qmd://bb/thread-thr-gone.md", title: "", snippet: "", score: 1 },
          { file: "qmd://bb/readme.md", title: "", snippet: "", score: 1 },
        ],
        catalog,
      ),
    ).toEqual([]);
  });
});

describe("combine", () => {
  const keyword = hitsFromKeyword([{ threadId: "t1", title: "Kw", snippet: "kw snippet" }], catalog);

  it("marks a hit found by both engines and keeps BB's snippet", () => {
    const semantic = hitsFromQmd(
      [
        { file: "qmd://bb/thread-t1.md", title: "Sem", snippet: "sem", score: 1 },
        { file: "qmd://bb/thread-t1.md", title: "Sem", snippet: "chunk 2", score: 0.5 },
        { file: "qmd://bb/task-x.md", title: "BBP-2", snippet: "", score: 0.4 },
      ],
      catalog,
    );
    const result = combine(keyword, semantic, 10);
    expect(result[0]).toMatchObject({ key: "thread:t1", via: ["keyword", "semantic"], snippet: "kw snippet" });
    expect(result).toHaveLength(2);
  });

  it("works with keyword hits alone (qmd missing)", () => {
    expect(combine(keyword, [], 10)).toEqual(keyword);
  });
});
