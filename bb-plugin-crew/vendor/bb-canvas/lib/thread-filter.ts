// The Canvas toolbar filters (BBP-189 AK 4) as one pure step between
// `threads.list` and `threadTree`. Every narrowing filter runs before the
// thread limit, so "50 threads of project X" means 50 of X, not the X-share
// of the newest 50 overall.
import { threadStatus, type ThreadListItem } from "./thread-tree";
import type { CanvasStatus } from "./types";

export type ThreadFilter = {
  /** Only threads updated within this many ms of now; null = any age. */
  windowMs: number | null;
  /** At most this many threads, newest first; null = all. */
  limit: number | null;
  /** At most this many turns under an opened thread, newest kept; null = all. */
  turnsPerThread: number | null;
  hideArchived: boolean;
  /** Empty means every project — never an empty canvas waiting for a pick. */
  projectIds: readonly string[];
  /** Empty means every status. */
  statuses: readonly CanvasStatus[];
};

export const DEFAULT_THREAD_FILTER: ThreadFilter = {
  windowMs: null,
  limit: 50,
  turnsPerThread: 20,
  hideArchived: true,
  projectIds: [],
  statuses: [],
};

export function filterThreads(threads: readonly ThreadListItem[], filter: ThreadFilter, now: number): ThreadListItem[] {
  const projects = new Set(filter.projectIds);
  const statuses = new Set(filter.statuses);
  const kept = threads
    .filter((thread) => !(filter.hideArchived && thread.archivedAt !== null))
    .filter((thread) => filter.windowMs === null || now - thread.updatedAt <= filter.windowMs)
    .filter((thread) => projects.size === 0 || projects.has(thread.projectId))
    .filter((thread) => statuses.size === 0 || statuses.has(threadStatus(thread.status)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return filter.limit === null ? kept : kept.slice(0, filter.limit);
}

/** The newest `limit` turns, still in timeline order. */
export function limitTurns<T>(turns: readonly T[], limit: number | null): T[] {
  return limit === null || turns.length <= limit ? [...turns] : turns.slice(turns.length - limit);
}
