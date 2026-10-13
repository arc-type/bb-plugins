// The Canvas nav page (BBP-189): every thread BB lists, chat threads
// included, under Agents → its project. Reads the SDK directly — no crew or
// Graph Studio RPC — so it works with neither installed. A thread's turns
// load only when it is opened (the newest `turnsPerThread` of them);
// `thread:changed` keeps status and loaded turns current. The same page is
// the thread panel's "Canvas" tab, focused on that thread (BBP-277).
import { useEffect, useMemo, useRef, useState } from "react";
import { ThreadChat, useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
import { FocusUnavailable } from "../vendor/bb-canvas/components/FocusUnavailable";
import { missingFocusIds, visibleFocusIds } from "../vendor/bb-canvas/lib/focus-filter";
import { overviewTree } from "../vendor/bb-canvas/lib/overview";
import type { ProjectLike, ThreadListItem } from "../vendor/bb-canvas/lib/thread-tree";
import { DEFAULT_THREAD_FILTER, limitTurns, type ThreadFilter } from "../vendor/bb-canvas/lib/thread-filter";
import { loadProjectFilter, saveProjectFilter } from "../vendor/bb-canvas/lib/project-filter";
import {
  enrichTurnNodes,
  threadNodeId,
  timelineToCanvas,
  turnDetailsToCanvas,
  type TimelineRowLike,
  type TurnFirstLinePort,
} from "../vendor/bb-canvas/lib/canvas-threads";
import type { CanvasEdge, CanvasNode } from "../vendor/bb-canvas/lib/types";
import { CanvasFilters } from "./canvas-filters";

type State = { projects: ProjectLike[]; threads: readonly ThreadListItem[] } | { error: string } | null;
type Sdk = ReturnType<typeof useSdk>;

async function turnDetails(sdk: Sdk, threadId: string, turnId: string, sourceSeqStart: number, sourceSeqEnd: number) {
  const response = await sdk.threads.timelineTurnSummaryDetails({
    threadId,
    turnId,
    sourceSeqStart: String(sourceSeqStart),
    sourceSeqEnd: String(sourceSeqEnd),
  });
  return { rows: response.rows as unknown as readonly TimelineRowLike[] };
}

function turnFirstLinePort(sdk: Sdk): TurnFirstLinePort {
  return { turnDetails: (turnId, threadId, start, end) => turnDetails(sdk, threadId, turnId, start, end) };
}

/** Keeps only the newest `limit` turn nodes (and the edges among what is left). */
function limitTurnNodes<R extends { nodes: CanvasNode[]; edges?: CanvasEdge[] }>(
  result: R,
  limit: number | null,
): R {
  const kept = new Set(limitTurns(result.nodes.filter((node) => node.kind === "turn"), limit).map((node) => node.id));
  const nodes = result.nodes.filter((node) => node.kind !== "turn" || kept.has(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = result.edges?.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  return { ...result, nodes, ...(edges ? { edges } : {}) };
}

/** A turn shows its newest this many steps; older ones sit behind "+N earlier". */
const STEPS_PER_TURN = 10;

export async function loadChildren(sdk: Sdk, node: CanvasNode, turnsPerThread: number | null = DEFAULT_THREAD_FILTER.turnsPerThread) {
  const { threadId, turnId, sourceSeqStart, sourceSeqEnd } = node.meta ?? {};
  if (typeof threadId !== "string") return { nodes: [] };
  if (node.kind === "thread") {
    const response = await sdk.threads.timeline({ threadId });
    const result = limitTurnNodes(timelineToCanvas(threadId, { rows: response.rows as unknown as readonly TimelineRowLike[] }), turnsPerThread);
    return { ...result, nodes: await enrichTurnNodes(result.nodes, turnFirstLinePort(sdk)) };
  }
  if (node.kind === "turn" && typeof turnId === "string" && typeof sourceSeqStart === "number" && typeof sourceSeqEnd === "number") {
    return turnDetailsToCanvas(node.id, await turnDetails(sdk, threadId, turnId, sourceSeqStart, sourceSeqEnd), threadId, STEPS_PER_TURN);
  }
  return { nodes: [] };
}

/** The runtime status a `thread:changed` event carries, if any. */
function eventStatus(event: { metadata?: unknown }): string | null {
  const status = (event.metadata as { statusChange?: { runtime?: { displayStatus?: unknown } } } | undefined)?.statusChange?.runtime?.displayStatus;
  return typeof status === "string" ? status : null;
}

/** The nav page's deep link `thread/<id>`, the thread panel's own thread otherwise. */
function focusFromSubPath(subPath: string | undefined): string | null {
  const match = /^thread\/([^/]+)$/.exec(subPath ?? "");
  return match ? decodeURIComponent(match[1]!) : null;
}

/** The overview defaults (BBP-283): window, thread limit and turns per thread. */
export type OverviewSettings = Pick<ThreadFilter, "windowMs" | "limit" | "turnsPerThread">;

/**
 * The page's props, fixed up front (BBP-285) so the BBP-283 work items can
 * fill them in parallel. `overview` overrides the default filter; `activeOnly`
 * is the toggle's default until the user flips it (then stored); `layout`
 * takes effect in its own item.
 */
export type CanvasPageProps = {
  subPath?: string;
  focusThreadId?: string;
  overview?: Partial<OverviewSettings>;
  activeOnly?: boolean;
  layout?: "tabs" | "split";
};

const ACTIVE_ONLY_KEY = "bb-canvas:active-only";

function loadActiveOnly(): boolean | null {
  try {
    const raw = localStorage.getItem(ACTIVE_ONLY_KEY);
    return raw === null ? null : raw === "true";
  } catch {
    return null;
  }
}

function saveActiveOnly(value: boolean) {
  try {
    localStorage.setItem(ACTIVE_ONLY_KEY, String(value));
  } catch {
    // Storage blocked: the toggle still works for this page.
  }
}

export function CanvasPage({ subPath, focusThreadId, overview, activeOnly: activeOnlyDefault = false }: CanvasPageProps) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [state, setState] = useState<State>(null);
  const [focus, setFocus] = useState<string | null>(() => focusThreadId ?? focusFromSubPath(subPath));
  const [tab, setTab] = useState<"graph" | "chat">("graph");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  // The project pick is shared with the Activity Canvas pages via the same
  // stored key; the other filters reset with the page.
  const [filter, setFilter] = useState<ThreadFilter>(() => ({ ...DEFAULT_THREAD_FILTER, ...overview, projectIds: loadProjectFilter() }));
  const changeFilter = (next: ThreadFilter) => {
    if (next.projectIds !== filter.projectIds) saveProjectFilter(next.projectIds);
    setFilter(next);
  };
  const [activeOnly, setActiveOnlyState] = useState(() => loadActiveOnly() ?? activeOnlyDefault);
  const setActiveOnly = (value: boolean) => {
    saveActiveOnly(value);
    setActiveOnlyState(value);
  };
  const turnsPerThread = useRef(filter.turnsPerThread);
  turnsPerThread.current = filter.turnsPerThread;
  // Per thread node: bumped on every `thread:changed`; CanvasView reloads
  // only the threads whose turns are already loaded.
  const [reloads, setReloads] = useState<ReadonlyMap<string, number>>(new Map());

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
    return overviewTree({ projects: state.projects, threads: state.threads, filter, focusThreadId: focus, now: Date.now(), activeOnly });
  }, [state, filter, focus, activeOnly]);
  const focusIds = useMemo(() => (focus === null ? [] : [threadNodeId(focus)]), [focus]);

  useEffect(
    () =>
      sdk.subscribe({
        event: "thread:changed",
        callback: (event) => {
          const threadId = event.id;
          if (!threadId) return;
          const status = eventStatus(event);
          if (status)
            setState((prev) =>
              prev && "threads" in prev
                ? { ...prev, threads: prev.threads.map((thread) => (thread.id === threadId ? { ...thread, status } : thread)) }
                : prev,
            );
          const id = threadNodeId(threadId);
          setReloads((prev) => new Map(prev).set(id, (prev.get(id) ?? 0) + 1));
        },
      }),
    [sdk],
  );

  if (state === null) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if ("error" in state) return <div className="p-4 text-sm text-destructive">Canvas not available: {state.error}</div>;
  // Before the empty states: a focus on a thread that is gone is the answer
  // the user needs, whether or not anything else is left to show.
  if (layer !== null && focusIds.length > 0 && missingFocusIds(layer.nodes, focusIds).length === focusIds.length)
    return <FocusUnavailable onShowAll={() => setFocus(null)} />;
  if (state.threads.length === 0) return <div className="p-4 text-sm text-muted-foreground">No threads yet.</div>;
  const toolbar = (
    <>
      <CanvasFilters projects={state.projects} filter={filter} onChange={changeFilter} />
      <button
        type="button"
        aria-pressed={activeOnly}
        onClick={() => setActiveOnly(!activeOnly)}
        className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${activeOnly ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
      >
        Active only
      </button>
    </>
  );
  if (activeOnly && (layer === null || layer.nodes.length === 0))
    return (
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1">{toolbar}</div>
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          Nothing is running right now.
          <button
            type="button"
            onClick={() => setActiveOnly(false)}
            className="rounded px-1 text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
          >
            Show everything
          </button>
        </div>
      </div>
    );
  if (layer === null || layer.nodes.length === 0)
    return (
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-1">{toolbar}</div>
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          No threads match the filters.
          <button
            type="button"
            onClick={() => changeFilter({ ...DEFAULT_THREAD_FILTER, projectIds: [] })}
            className="rounded px-1 text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
          >
            Reset filters
          </button>
        </div>
      </div>
    );
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
            className={`-mb-px border-b-2 px-2 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
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
          // A thread always has turns to fetch; a turn only if it has steps.
          canLoadChildren={(node) =>
            (node.kind === "thread" && typeof node.meta?.threadId === "string") ||
            (node.kind === "turn" && typeof node.meta?.summaryCount === "number" && node.meta.summaryCount > 0)
          }
          loadChildren={(node) => loadChildren(sdk, node, turnsPerThread.current)}
          reloadChildren={reloads}
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
