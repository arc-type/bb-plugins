import { describe, expect, it } from "vitest";
import { emptyState, messagesFromEvents, mirrorPass, type IndexSources, type MirrorFiles } from "../lib/indexer.js";
import type { TaskDoc } from "../lib/mirror.js";

function memoryFiles(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const files: MirrorFiles = {
    list: async () => [...store.keys()],
    write: async (name, content) => void store.set(name, content),
    remove: async (name) => void store.delete(name),
  };
  return { store, files };
}

const task = (id: string, updatedAt = "1"): TaskDoc => ({ id, key: `BBP-${id}`, title: "t", status: "todo", priority: "none", description: "", updatedAt });

function sources(threads: { id: string; updatedAt: number }[], tasks: TaskDoc[] | null) {
  const fetched: string[] = [];
  const src: IndexSources = {
    listThreads: async () => threads.map((thread) => ({ ...thread, projectId: "p", title: thread.id })),
    threadMessages: async (id) => {
      fetched.push(id);
      return [{ role: "user", text: `hello ${id}` }];
    },
    listTasks: async () => tasks,
  };
  return { src, fetched };
}

const signal = new AbortController().signal;

describe("mirrorPass", () => {
  it("writes every document on the first pass", async () => {
    const { store, files } = memoryFiles();
    const { src } = sources([{ id: "t1", updatedAt: 1 }], [task("a")]);
    const result = await mirrorPass(src, files, emptyState(), signal);
    expect([...store.keys()].sort()).toEqual(["task-a.md", "thread-t1.md"]);
    expect(result).toMatchObject({ written: 2, removed: 0, documents: 2 });
  });

  it("fetches nothing for unchanged threads and rewrites a changed one", async () => {
    const { files } = memoryFiles({ "thread-t1.md": "x", "thread-t2.md": "y" });
    const { src, fetched } = sources([{ id: "t1", updatedAt: 1 }, { id: "t2", updatedAt: 5 }], []);
    const result = await mirrorPass(src, files, { threads: { t1: 1, t2: 2 }, tasks: {} }, signal);
    expect(fetched).toEqual(["t2"]);
    expect(result.state.threads).toEqual({ t1: 1, t2: 5 });
  });

  it("removes files of deleted objects but never foreign files", async () => {
    const { store, files } = memoryFiles({ "thread-gone.md": "x", "README.md": "keep" });
    const { src } = sources([], []);
    const result = await mirrorPass(src, files, { threads: { gone: 1 }, tasks: {} }, signal);
    expect(store.has("thread-gone.md")).toBe(false);
    expect(store.has("README.md")).toBe(true);
    expect(result.removed).toBe(1);
  });

  it("keeps previous task files when tasks cannot be read", async () => {
    const { store, files } = memoryFiles({ "task-a.md": "old" });
    const { src } = sources([], null);
    const result = await mirrorPass(src, files, { threads: {}, tasks: { a: "1" } }, signal);
    expect(store.get("task-a.md")).toBe("old");
    expect(result.state.tasks).toEqual({ a: "1" });
  });

  it("removes a task once the readable task list no longer has it", async () => {
    const { store, files } = memoryFiles({ "task-a.md": "old" });
    const { src } = sources([], []);
    await mirrorPass(src, files, { threads: {}, tasks: { a: "1" } }, signal);
    expect(store.has("task-a.md")).toBe(false);
  });

  it("deletes nothing after an abort, so a half pass cannot wipe the mirror", async () => {
    const { store, files } = memoryFiles({ "thread-old.md": "x" });
    const controller = new AbortController();
    controller.abort();
    const { src } = sources([], []);
    await mirrorPass(src, files, emptyState(), controller.signal);
    expect(store.has("thread-old.md")).toBe(true);
  });
});

describe("messagesFromEvents", () => {
  it("keeps user text and agent messages only", () => {
    const messages = messagesFromEvents([
      { type: "client/turn/requested", data: { input: [{ type: "text", text: "hi" }, { type: "image", url: "x" }] } },
      { type: "item/completed", data: { item: { type: "agentMessage", text: "hello" } } },
      { type: "item/completed", data: { item: { type: "commandExecution", text: "ls output" } } },
      { type: "item/completed", data: { item: { type: "agentMessage", text: "  " } } },
      { type: "turn/started", data: null },
    ]);
    expect(messages).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello" },
    ]);
  });

  it("survives malformed event data", () => {
    expect(messagesFromEvents([{ type: "client/turn/requested", data: { input: "nope" } }, { type: "item/completed", data: undefined }])).toEqual([]);
  });
});
