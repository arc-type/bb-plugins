import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listMarkdown, parseFolderSetting, pathResolver } from "../lib/folders.js";

describe("parseFolderSetting", () => {
  it("reads absolute paths, skips comments and blanks", () => {
    const { folders, invalid } = parseFolderSetting("/Users/me/brain/\n\n# old\n/srv/docs");
    expect(folders).toEqual([
      { collection: "folder-brain", root: "/Users/me/brain", label: "brain" },
      { collection: "folder-docs", root: "/srv/docs", label: "docs" },
    ]);
    expect(invalid).toEqual([]);
  });

  it("reports relative paths instead of indexing them", () => {
    expect(parseFolderSetting("brain\n~/notes")).toEqual({ folders: [], invalid: ["brain", "~/notes"] });
  });

  it("gives two folders with the same name distinct collections", () => {
    const { folders } = parseFolderSetting("/a/docs\n/b/docs");
    expect(folders.map((folder) => folder.collection)).toEqual(["folder-docs", "folder-docs-2"]);
  });

  it("returns null for a path that is not in the list", () => {
    expect(pathResolver(["a.md"])("b.md")).toBeNull();
  });
});

describe("listMarkdown", () => {
  it("finds Markdown files and skips tool folders", async () => {
    const root = await mkdtemp(join(tmpdir(), "recall-"));
    await mkdir(join(root, "90 Wiki"), { recursive: true });
    await mkdir(join(root, ".obsidian"), { recursive: true });
    await writeFile(join(root, "90 Wiki", "a.md"), "# a");
    await writeFile(join(root, "b.txt"), "b");
    await writeFile(join(root, ".obsidian", "c.md"), "c");
    expect(await listMarkdown(root)).toEqual(["90 Wiki/a.md"]);
  });

  it("returns nothing for a folder that does not exist", async () => {
    expect(await listMarkdown("/definitely/not/here")).toEqual([]);
  });

  it("returns null for a path that is not in the list", () => {
    expect(pathResolver(["a.md"])("b.md")).toBeNull();
  });
});

describe("pathResolver", () => {
  it("maps qmd's normalized path back to the real one", () => {
    expect(pathResolver(["90 Wiki/a b.md"])("90-wiki/a-b.md")).toBe("90 Wiki/a b.md");
  });

  it("returns null for a path that is not in the list", () => {
    expect(pathResolver(["a.md"])("b.md")).toBeNull();
  });
});
