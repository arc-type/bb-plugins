// The Canvas nav page (BBP-189): every thread BB lists, chat threads
// included, under Agents → its project. Reads the SDK directly — no crew or
// Graph Studio RPC — so it works with neither installed. A thread's turns
// load only when it is opened (the newest `turnsPerThread` of them);
// `thread:changed` keeps status and loaded turns current.
import { useEffect, useMemo, useRef, useState } from "react";
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
import { threadTree, type ProjectLike, type ThreadListItem } from "../vendor/bb-canvas/lib/thread-tree";
import { DEFAULT_THREAD_FILTER, filterThreads, limitTurns, type ThreadFilter } from "../vendor/bb-canvas/lib/thread-filter";
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

export async function loadChildren(sdk: Sdk, node: CanvasNode, turnsPerThread: number | null = DEFAULT_THREAD_FILTER.turnsPerThread) {
  const { threadId, turnId, sourceSeqStart, sourceSeqEnd } = node.meta ?? {};
  if (typeof threadId !== "string") return { nodes: [] };
  if (node.kind === "thread") {
    const response = await sdk.threads.timeline({ threadId });
    const result = limitTurnNodes(timelineToCanvas(threadId, { rows: response.rows as unknown as readonly TimelineRowLike[] }), turnsPerThread);
    return { ...result, nodes: await enrichTurnNodes(result.nodes, turnFirstLinePort(sdk)) };
  }
  if (node.kind === "turn" && typeof turnId === "string" && typeof sourceSeqStart === "number" && typeof sourceSeqEnd === "number") {
    return turnDetailsToCanvas(node.id, await turnDetails(sdk, threadId, turnId, sourceSeqStart, sourceSeqEnd), threadId);
  }
  return { nodes: [] };
}

/** The runtime status a `thread:changed` event carries, if any. */
function eventStatus(event: { metadata?: unknown }): string | null {
  const status = (event.metadata as { statusChange?: { runtime?: { displayStatus?: unknown } } } | undefined)?.statusChange?.runtime?.displayStatus;
  return typeof status === "string" ? status : null;
}

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

  const layer = useMemo(
    () => (state !== null && "threads" in state ? threadTree(state.projects, filterThreads(state.threads, filter, Date.now())) : null),
    [state, filter],
  );

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
  );
}
