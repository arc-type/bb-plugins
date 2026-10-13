// The Canvas nav page (BBP-189): every thread BB lists, chat threads
// included, under Agents → its project. Reads the SDK directly — no crew or
// Graph Studio RPC — so it works with neither installed.
import { useEffect, useMemo, useState } from "react";
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
import { threadTree, type ProjectLike, type ThreadListItem } from "../vendor/bb-canvas/lib/thread-tree";
import { DEFAULT_THREAD_FILTER, filterThreads, type ThreadFilter } from "../vendor/bb-canvas/lib/thread-filter";
import { loadProjectFilter, saveProjectFilter } from "../vendor/bb-canvas/lib/project-filter";
import { CanvasFilters } from "./canvas-filters";

type State = { projects: ProjectLike[]; threads: readonly ThreadListItem[] } | { error: string } | null;

export function CanvasPage(_props: { subPath?: string }) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [state, setState] = useState<State>(null);
  // The project pick is shared with the Activity Canvas pages via the same
  // stored key; the other filters reset with the page.
  const [filter, setFilter] = useState<ThreadFilter>(() => ({ ...DEFAULT_THREAD_FILTER, projectIds: loadProjectFilter() }));
  const changeFilter = (next: ThreadFilter) => {
    if (next.projectIds !== filter.projectIds) saveProjectFilter(next.projectIds);
    setFilter(next);
  };

  useEffect(() => {
    let cancelled = false;
    // An unreadable project list only costs the project names: the tree then
    // names each project by its id.
    const projects = sdk.projects.list().then(
      (list) => list.map((project): ProjectLike => ({ id: project.id, name: project.name ?? project.id })),
      () => [] as ProjectLike[],
    );
    Promise.all([projects, sdk.threads.list()]).then(
      ([projectList, threads]) => {
        if (!cancelled) setState({ projects: projectList, threads: threads as unknown as readonly ThreadListItem[] });
      },
      (cause: unknown) => {
        if (!cancelled) setState({ error: cause instanceof Error ? cause.message : String(cause) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  const layer = useMemo(
    () => (state !== null && "threads" in state ? threadTree(state.projects, filterThreads(state.threads, filter, Date.now())) : null),
    [state, filter],
  );

  if (state === null) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if ("error" in state) return <div className="p-4 text-sm text-destructive">Canvas not available: {state.error}</div>;
  if (state.threads.length === 0) return <div className="p-4 text-sm text-muted-foreground">No threads yet.</div>;
  const toolbar = <CanvasFilters projects={state.projects} filter={filter} onChange={changeFilter} />;
  if (layer === null || layer.nodes.length === 0)
    return (
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1">{toolbar}</div>
        <div className="p-4 text-sm text-muted-foreground">No threads match the filters.</div>
      </div>
    );
  return (
    <CanvasView
      nodes={layer.nodes}
      edges={layer.edges}
      initialExpanded={new Set(layer.expanded)}
      toolbar={toolbar}
      surface="canvas"
      onOpenThread={(threadId) => navigate.toThread(threadId)}
      className="h-full"
    />
  );
}
