// The Canvas overview (BBP-283) as one pure pipeline from `threads.list` to
// the visible tree: project/focus → window → limit → active only. Every
// narrowing step runs before the limit, so "20 threads of project X" means
// 20 of X. The thread the canvas was opened for stays in view even when the
// archived flag, the window or the limit would drop it.
import { DEFAULT_THREAD_FILTER, filterThreads, narrowThreads, type ThreadFilter } from "./thread-filter";
import { threadTree, type ProjectLike, type ThreadListItem } from "./thread-tree";

export type OverviewInput = {
  projects: readonly ProjectLike[];
  threads: readonly ThreadListItem[];
  filter: ThreadFilter;
  /** The thread the canvas is focused on, if any. */
  focusThreadId: string | null;
  now: number;
};

export type Overview = ReturnType<typeof threadTree> & {
  /** Threads the window and limit let through (the focused extra not counted). */
  shown: number;
  /** Threads the project, status and archived filters let through. */
  total: number;
};

export function overviewTree({ projects, threads, filter, focusThreadId, now }: OverviewInput): Overview {
  const shown = filterThreads(threads, filter, now);
  const focused =
    focusThreadId !== null && !shown.some((thread) => thread.id === focusThreadId)
      ? threads.find((thread) => thread.id === focusThreadId)
      : undefined;
  return {
    ...threadTree(projects, focused ? [...shown, focused] : shown),
    shown: shown.length,
    total: narrowThreads(threads, filter).length,
  };
}

const HOUR = 3_600_000;

/** The toolbar's hint, e.g. "Last 12 h · 20 of 73". */
export function overviewSummary(filter: Pick<ThreadFilter, "windowMs">, shown: number, total: number): string {
  const count = `${shown} of ${total}`;
  return filter.windowMs === null ? count : `Last ${Math.round(filter.windowMs / HOUR)} h · ${count}`;
}

export type OverviewSettings = Pick<ThreadFilter, "windowMs" | "limit" | "turnsPerThread">;

/** An integer inside [min, max], or the fallback. */
function inRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/**
 * The plugin settings (windowHours 1–720, maxThreads 1–100, overviewTurns
 * 0–10, as agent-graph) as overview filter values; anything missing or out
 * of range falls back to the default.
 */
export function overviewSettings(values: Readonly<Record<string, unknown>> | undefined): OverviewSettings {
  const fallback = DEFAULT_THREAD_FILTER;
  return {
    windowMs: inRange(values?.windowHours, 1, 720, fallback.windowMs! / HOUR) * HOUR,
    limit: inRange(values?.maxThreads, 1, 100, fallback.limit!),
    turnsPerThread: inRange(values?.overviewTurns, 0, 10, fallback.turnsPerThread!),
  };
}
