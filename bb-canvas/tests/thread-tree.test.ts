import { describe, expect, it } from "vitest";
import { threadTree, type ThreadListItem } from "../lib/thread-tree";

const thread = (overrides: Partial<ThreadListItem> & { id: string; projectId: string }): ThreadListItem => ({
  title: null,
  titleFallback: null,
  status: "idle",
  providerId: "claude-code",
  archivedAt: null,
  updatedAt: 0,
  ...overrides,
});

describe("threadTree", () => {
  it("roots every thread under Agents → its project", () => {
    const layer = threadTree(
      [{ id: "p1", name: "Shop" }],
      [thread({ id: "t1", projectId: "p1", title: "Fix login bug" })],
    );
    expect(layer.nodes.map(({ id, kind, label, parentId }) => ({ id, kind, label, parentId }))).toEqual([
      { id: "agents", kind: "agents", label: "Agents", parentId: null },
      { id: "project:p1", kind: "project", label: "Shop", parentId: "agents" },
      { id: "thread:t1", kind: "thread", label: "Fix login bug", parentId: "project:p1" },
    ]);
    expect(layer.expanded).toEqual(["agents", "project:p1"]);
    expect(layer.edges).toEqual([]);
  });

  it("carries threadId, state and provider on the thread node", () => {
    const [, , node] = threadTree([{ id: "p1", name: "Shop" }], [thread({ id: "t1", projectId: "p1", status: "active", providerId: "codex" })]).nodes;
    expect(node.meta).toEqual({ threadId: "t1", state: "active", provider: "codex" });
    expect(node.status).toBe("running");
  });

  it("maps an errored thread to failed and an idle one to idle", () => {
    const nodes = threadTree(
      [{ id: "p1", name: "Shop" }],
      [thread({ id: "t1", projectId: "p1", status: "error" }), thread({ id: "t2", projectId: "p1", status: "idle" })],
    ).nodes;
    expect(nodes.find((node) => node.id === "thread:t1")?.status).toBe("failed");
    expect(nodes.find((node) => node.id === "thread:t2")?.status).toBe("idle");
  });

  it("labels an untitled thread with its fallback title, else 'Thread'", () => {
    const nodes = threadTree(
      [{ id: "p1", name: "Shop" }],
      [thread({ id: "t1", projectId: "p1", titleFallback: "Ship it" }), thread({ id: "t2", projectId: "p1" })],
    ).nodes;
    expect(nodes.find((node) => node.id === "thread:t1")?.label).toBe("Ship it");
    expect(nodes.find((node) => node.id === "thread:t2")?.label).toBe("Thread");
  });

  it("lists the most recently updated thread first within a project", () => {
    const nodes = threadTree(
      [{ id: "p1", name: "Shop" }],
      [thread({ id: "old", projectId: "p1", updatedAt: 1 }), thread({ id: "new", projectId: "p1", updatedAt: 2 })],
    ).nodes;
    expect(nodes.filter((node) => node.kind === "thread").map((node) => node.id)).toEqual(["thread:new", "thread:old"]);
  });

  it("names a project missing from the project list by its id instead of dropping its threads", () => {
    const nodes = threadTree([], [thread({ id: "t1", projectId: "p9" })]).nodes;
    expect(nodes.find((node) => node.id === "project:p9")?.label).toBe("p9");
    expect(nodes.find((node) => node.id === "thread:t1")?.parentId).toBe("project:p9");
  });

  it("leaves out projects without threads", () => {
    const nodes = threadTree([{ id: "p1", name: "Shop" }, { id: "p2", name: "Blog" }], [thread({ id: "t1", projectId: "p1" })]).nodes;
    expect(nodes.some((node) => node.id === "project:p2")).toBe(false);
  });

  it("returns an empty layer without threads", () => {
    expect(threadTree([{ id: "p1", name: "Shop" }], [])).toEqual({ nodes: [], edges: [], expanded: [] });
  });
});
