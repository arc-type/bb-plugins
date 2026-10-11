import { describe, expect, it } from "vitest";
import { docFileName, MAX_MESSAGE_CHARS, parseDocFileName, renderTask, renderThread } from "../lib/mirror.js";

describe("docFileName", () => {
  it("round-trips through parseDocFileName", () => {
    expect(parseDocFileName(docFileName("thread", "thr_abc"))).toEqual({ kind: "thread", id: "thr_abc" });
    expect(parseDocFileName(`qmd://bb/${docFileName("task", "01M4")}`)).toEqual({ kind: "task", id: "01M4" });
  });

  it("rejects ids that could escape the mirror directory", () => {
    expect(() => docFileName("thread", "../etc/passwd")).toThrow();
    expect(() => docFileName("task", "a/b")).toThrow();
  });

  it("ignores files the mirror did not write", () => {
    expect(parseDocFileName("notes.md")).toBeNull();
    expect(parseDocFileName("thread-abc.txt")).toBeNull();
    expect(parseDocFileName("qmd://brain/10-Projects/thread.md")).toBeNull();
  });
});

describe("renderThread", () => {
  it("writes title, roles and skips empty messages", () => {
    const md = renderThread({
      id: "thr_1",
      projectId: "proj_1",
      title: "Fix\nsearch",
      updatedAt: 0,
      messages: [
        { role: "user", text: "Why is search lexical?" },
        { role: "assistant", text: "   " },
        { role: "assistant", text: "Because FTS5." },
      ],
    });
    expect(md).toContain("# Fix search");
    expect(md).toContain("## User\n\nWhy is search lexical?");
    expect(md.match(/## Assistant/g)).toHaveLength(1);
  });

  it("clips a huge message but keeps a short one whole", () => {
    const long = "x".repeat(MAX_MESSAGE_CHARS + 500);
    const md = renderThread({ id: "t", projectId: "p", title: "", updatedAt: 0, messages: [{ role: "user", text: long }] });
    expect(md).not.toContain(long);
    expect(md).toContain(`${"x".repeat(MAX_MESSAGE_CHARS)} …`);
    expect(md).toContain("# t");
  });
});

describe("renderTask", () => {
  it("puts the key in the title line for ranking", () => {
    const md = renderTask({ id: "01M", key: "BBP-1", title: "Search", status: "todo", priority: "high", description: "Body", updatedAt: "2026-10-09" });
    expect(md).toContain("# BBP-1 Search");
    expect(md).toContain("Status: todo · Priority: high");
    expect(md.startsWith("# BBP-1")).toBe(true);
  });
});
