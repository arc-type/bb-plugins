import { describe, expect, it } from "vitest";
import { DEFAULT_THREAD_FILTER, filterThreads, limitTurns, type ThreadFilter } from "../lib/thread-filter";
import type { ThreadListItem } from "../lib/thread-tree";

const HOUR = 3_600_000;
const NOW = 100 * HOUR;

const thread = (overrides: Partial<ThreadListItem> & { id: string }): ThreadListItem => ({
  projectId: "p1",
  title: null,
  titleFallback: null,
  status: "idle",
  providerId: "claude-code",
  archivedAt: null,
  updatedAt: NOW,
  ...overrides,
});

const ids = (threads: readonly ThreadListItem[]) => threads.map((t) => t.id);
const only = (patch: Partial<ThreadFilter>): ThreadFilter => ({
  ...DEFAULT_THREAD_FILTER,
  windowMs: null,
  limit: null,
  hideArchived: false,
  ...patch,
});

describe("filterThreads", () => {
  it("hides archived threads by default", () => {
    const threads = [thread({ id: "a" }), thread({ id: "b", archivedAt: NOW - HOUR })];
    expect(DEFAULT_THREAD_FILTER.hideArchived).toBe(true);
    expect(ids(filterThreads(threads, DEFAULT_THREAD_FILTER, NOW))).toEqual(["a"]);
    expect(ids(filterThreads(threads, only({ hideArchived: false }), NOW))).toEqual(["a", "b"]);
  });

  it("keeps only threads updated inside the time window", () => {
    const threads = [thread({ id: "new", updatedAt: NOW - HOUR }), thread({ id: "old", updatedAt: NOW - 30 * HOUR })];
    expect(ids(filterThreads(threads, only({ windowMs: 24 * HOUR }), NOW))).toEqual(["new"]);
    expect(ids(filterThreads(threads, only({ windowMs: null }), NOW))).toEqual(["new", "old"]);
  });

  it("caps the count at the thread limit, newest first", () => {
    const threads = [thread({ id: "1", updatedAt: 1 }), thread({ id: "3", updatedAt: 3 }), thread({ id: "2", updatedAt: 2 })];
    expect(ids(filterThreads(threads, only({ limit: 2 }), NOW))).toEqual(["3", "2"]);
  });

  it("an empty project selection hides nothing; a selection narrows", () => {
    const threads = [thread({ id: "a", projectId: "p1" }), thread({ id: "b", projectId: "p2" })];
    expect(ids(filterThreads(threads, only({ projectIds: [] }), NOW))).toEqual(["a", "b"]);
    expect(ids(filterThreads(threads, only({ projectIds: ["p2"] }), NOW))).toEqual(["b"]);
  });

  it("filters by the status the canvas shows", () => {
    const threads = [thread({ id: "run", status: "active" }), thread({ id: "err", status: "error" }), thread({ id: "idle" })];
    expect(ids(filterThreads(threads, only({ statuses: ["running"] }), NOW))).toEqual(["run"]);
    expect(ids(filterThreads(threads, only({ statuses: ["failed", "idle"] }), NOW))).toEqual(["err", "idle"]);
  });

  it("combines filters before the limit applies", () => {
    const threads = [
      thread({ id: "x", projectId: "p2", updatedAt: NOW }),
      thread({ id: "a", projectId: "p1", updatedAt: NOW - 1 }),
      thread({ id: "b", projectId: "p1", updatedAt: NOW - 2 }),
    ];
    expect(ids(filterThreads(threads, only({ projectIds: ["p1"], limit: 1 }), NOW))).toEqual(["a"]);
  });
});

describe("limitTurns", () => {
  it("keeps the newest turns, in their order", () => {
    expect(limitTurns([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(limitTurns([1, 2], null)).toEqual([1, 2]);
  });
});

// BBP-287 (BBP-225): running, waiting and failed threads never fall out of
// the overview, whatever their age or the limit.
describe("filterThreads keeps live threads", () => {
  it("shows a running thread three days old although the window is 12 h", () => {
    const threads = [thread({ id: "busy", status: "active", updatedAt: NOW - 72 * HOUR }), thread({ id: "done", updatedAt: NOW - 72 * HOUR })];
    expect(ids(filterThreads(threads, only({ windowMs: 12 * HOUR }), NOW))).toEqual(["busy"]);
  });

  it("keeps a failed thread beyond the limit", () => {
    const threads = [thread({ id: "new", updatedAt: NOW }), thread({ id: "err", status: "error", updatedAt: NOW - HOUR })];
    expect(ids(filterThreads(threads, only({ limit: 1 }), NOW))).toEqual(["new", "err"]);
  });

  it("still drops a live thread of a project that is not picked", () => {
    const threads = [thread({ id: "busy", status: "active", projectId: "p2" })];
    expect(ids(filterThreads(threads, only({ projectIds: ["p1"] }), NOW))).toEqual([]);
  });

  it("defaults to the last 12 h, 20 threads and 1 turn", () => {
    expect(DEFAULT_THREAD_FILTER).toMatchObject({ windowMs: 12 * HOUR, limit: 20, turnsPerThread: 1 });
  });
});
