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
