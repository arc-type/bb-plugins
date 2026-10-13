// The Canvas nav page (BBP-189): every thread BB lists, chat threads
// included, under Agents → its project. Reads the SDK directly — no crew or
// Graph Studio RPC — so it works with neither installed. The same page is
// the thread panel's "Canvas" tab, focused on that thread (BBP-277).
import { useEffect, useMemo, useState } from "react";
import { ThreadChat, useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
import { FocusUnavailable } from "../vendor/bb-canvas/components/FocusUnavailable";
import { threadNodeId } from "../vendor/bb-canvas/lib/canvas-threads";
import { missingFocusIds, visibleFocusIds } from "../vendor/bb-canvas/lib/focus-filter";
import { threadTree, type ProjectLike, type ThreadListItem } from "../vendor/bb-canvas/lib/thread-tree";
import { DEFAULT_THREAD_FILTER, filterThreads, type ThreadFilter } from "../vendor/bb-canvas/lib/thread-filter";
import { loadProjectFilter, saveProjectFilter } from "../vendor/bb-canvas/lib/project-filter";
import { CanvasFilters } from "./canvas-filters";

type State = { projects: ProjectLike[]; threads: readonly ThreadListItem[] } | { error: string } | null;

/** The nav page's deep link `thread/<id>`, the thread panel's own thread otherwise. */
function focusFromSubPath(subPath: string | undefined): string | null {
  const match = /^thread\/([^/]+)$/.exec(subPath ?? "");
  return match ? decodeURIComponent(match[1]!) : null;
}

export function CanvasPage({ subPath, focusThreadId }: { subPath?: string; focusThreadId?: string }) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [state, setState] = useState<State>(null);
  const [focus, setFocus] = useState<string | null>(() => focusThreadId ?? focusFromSubPath(subPath));
  const [tab, setTab] = useState<"graph" | "chat">("graph");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
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

  const layer = useMemo(() => {
    if (state === null || !("threads" in state)) return null;
    const shown = filterThreads(state.threads, filter, Date.now());
    // The thread someone opened the canvas for stays in view even when an
    // archived flag, the window or the limit would drop it.
    const focused = focus !== null && !shown.some((thread) => thread.id === focus) ? state.threads.find((thread) => thread.id === focus) : undefined;
    return threadTree(state.projects, focused ? [...shown, focused] : shown);
  }, [state, filter, focus]);
  const focusIds = useMemo(() => (focus === null ? [] : [threadNodeId(focus)]), [focus]);

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
  if (focusIds.length > 0 && missingFocusIds(layer.nodes, focusIds).length === focusIds.length)
    return <FocusUnavailable onShowAll={() => setFocus(null)} />;
  const visible = visibleFocusIds(layer.nodes, focusIds);
  const chatThreadId = selectedThreadId ?? focus;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Canvas view" className="flex gap-1 border-b border-border px-2 pt-1">
        {(["graph", "chat"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-2 py-1 text-xs ${tab === id ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
          >
            {id === "graph" ? "Graph" : "Chat"}
          </button>
        ))}
      </div>
      {/* The graph stays mounted behind the Chat tab so its selection,
          expansion and viewport survive a look at the chat. */}
      <div role="tabpanel" hidden={tab !== "graph"} className="min-h-0 flex-1">
        <CanvasView
          nodes={layer.nodes.filter((node) => visible.has(node.id))}
          edges={layer.edges}
          initialExpanded={new Set(layer.expanded)}
          toolbar={toolbar}
          surface="canvas"
          focusSelected={focusIds}
          onSelectionChange={(node) => {
            const threadId = node?.meta?.threadId;
            setSelectedThreadId(typeof threadId === "string" ? threadId : null);
          }}
          onOpenThread={(threadId) => navigate.toThread(threadId)}
          className="h-full"
        />
      </div>
      {tab === "chat" ? (
        <div role="tabpanel" className="min-h-0 flex-1">
          {chatThreadId !== null ? (
            <ThreadChat threadId={chatThreadId} variant="compact" />
          ) : (
            <div className="p-4 text-sm text-muted-foreground">Select a thread to see its chat.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
