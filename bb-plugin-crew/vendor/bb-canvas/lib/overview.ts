// The Canvas overview (BBP-283) as one pure pipeline from `threads.list` to
// the visible tree: project/focus → window → limit → active only. Every
// narrowing step runs before the limit, so "20 threads of project X" means
// 20 of X. The thread the canvas was opened for stays in view even when the
// archived flag, the window or the limit would drop it.
import { filterThreads, type ThreadFilter } from "./thread-filter";
import { threadTree, type ProjectLike, type ThreadListItem } from "./thread-tree";

export type OverviewInput = {
  projects: readonly ProjectLike[];
  threads: readonly ThreadListItem[];
  filter: ThreadFilter;
  /** The thread the canvas is focused on, if any. */
  focusThreadId: string | null;
  now: number;
};

export function overviewTree({ projects, threads, filter, focusThreadId, now }: OverviewInput): ReturnType<typeof threadTree> {
  const shown = filterThreads(threads, filter, now);
  const focused =
    focusThreadId !== null && !shown.some((thread) => thread.id === focusThreadId)
      ? threads.find((thread) => thread.id === focusThreadId)
      : undefined;
  return threadTree(projects, focused ? [...shown, focused] : shown);
}
