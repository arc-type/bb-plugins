import { describe, expect, it } from "vitest";
import { overviewTree } from "../lib/overview";
import { DEFAULT_THREAD_FILTER } from "../lib/thread-filter";
import type { ThreadListItem } from "../lib/thread-tree";

const HOUR = 3_600_000;
const NOW = 100 * HOUR;

const thread = (overrides: Partial<ThreadListItem> & { id: string }): ThreadListItem => ({
  projectId: "p1",
  title: overrides.id,
  titleFallback: null,
  status: "idle",
  providerId: "claude-code",
  archivedAt: null,
  updatedAt: NOW,
  ...overrides,
});

const threadIds = (layer: ReturnType<typeof overviewTree>) =>
  layer.nodes.filter((node) => node.kind === "thread").map((node) => node.meta?.threadId);

describe("overviewTree", () => {
  it("limits threads after the project filter, newest first", () => {
    const threads = [
      thread({ id: "old", updatedAt: NOW - 3 * HOUR }),
      thread({ id: "other", projectId: "p2", updatedAt: NOW }),
      thread({ id: "new", updatedAt: NOW - HOUR }),
    ];
    const layer = overviewTree({
      projects: [],
      threads,
      filter: { ...DEFAULT_THREAD_FILTER, projectIds: ["p1"], limit: 1 },
      focusThreadId: null,
      now: NOW,
    });
    expect(threadIds(layer)).toEqual(["new"]);
  });

  it("keeps the focused thread in view although the filters drop it", () => {
    const threads = [thread({ id: "a" }), thread({ id: "gone", archivedAt: NOW - HOUR })];
    const layer = overviewTree({ projects: [], threads, filter: DEFAULT_THREAD_FILTER, focusThreadId: "gone", now: NOW });
    expect(threadIds(layer)).toEqual(["a", "gone"]);
  });
});

describe("overviewTree active only (BBP-288)", () => {
  const input = (threads: ThreadListItem[], focusThreadId: string | null = null) => ({
    projects: [],
    threads,
    filter: DEFAULT_THREAD_FILTER,
    focusThreadId,
    now: NOW,
    activeOnly: true,
  });

  it("keeps only active threads with their project path, after the other filters", () => {
    const layer = overviewTree(input([thread({ id: "run", status: "active" }), thread({ id: "idle" }), thread({ id: "gone", projectId: "p2" })]));
    expect(threadIds(layer)).toEqual(["run"]);
    expect(layer.nodes.some((node) => node.kind === "project" && node.id.includes("p2"))).toBe(false);
  });

  it("is empty when nothing runs", () => {
    expect(overviewTree(input([thread({ id: "idle" })])).nodes).toEqual([]);
  });

  it("still keeps the focused thread", () => {
    expect(threadIds(overviewTree(input([thread({ id: "run", status: "active" }), thread({ id: "idle" })], "idle")))).toEqual(["run", "idle"]);
  });
});
