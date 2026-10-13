// The Canvas overview (BBP-283) as one pure pipeline from `threads.list` to
// the visible tree: project/focus → window → limit → active only. Every
// narrowing step runs before the limit, so "20 threads of project X" means
// 20 of X. The thread the canvas was opened for stays in view even when the
// archived flag, the window or the limit would drop it.
import { filterActive } from "./active-filter";
import { threadNodeId } from "./canvas-threads";
import { filterThreads, type ThreadFilter } from "./thread-filter";
import { threadTree, type ProjectLike, type ThreadListItem } from "./thread-tree";

export type OverviewInput = {
  projects: readonly ProjectLike[];
  threads: readonly ThreadListItem[];
  filter: ThreadFilter;
  /** The thread the canvas is focused on, if any. */
  focusThreadId: string | null;
  now: number;
  /** Last step: only active threads and the path to them (BBP-288). */
  activeOnly?: boolean;
};

export function overviewTree({ projects, threads, filter, focusThreadId, now, activeOnly = false }: OverviewInput): ReturnType<typeof threadTree> {
  const shown = filterThreads(threads, filter, now);
  const focused =
    focusThreadId !== null && !shown.some((thread) => thread.id === focusThreadId)
      ? threads.find((thread) => thread.id === focusThreadId)
      : undefined;
  const tree = threadTree(projects, focused ? [...shown, focused] : shown);
  if (!activeOnly) return tree;
  const nodes = filterActive(tree.nodes, new Set(focusThreadId !== null ? [threadNodeId(focusThreadId)] : []));
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: tree.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)), expanded: tree.expanded.filter((id) => ids.has(id)) };
}
