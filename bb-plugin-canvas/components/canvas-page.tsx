// The Canvas nav page (BBP-189): every thread BB lists, chat threads
// included, under Agents → its project. Reads the SDK directly — no crew or
// Graph Studio RPC — so it works with neither installed. A thread's turns
// load only when it is opened; `thread:changed` keeps status and loaded turns
// current.
import { useEffect, useState } from "react";
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
import { threadStatus, threadTree, type ProjectLike, type ThreadListItem } from "../vendor/bb-canvas/lib/thread-tree";
import {
  enrichTurnNodes,
  threadNodeId,
  timelineToCanvas,
  turnDetailsToCanvas,
  type TimelineRowLike,
  type TurnFirstLinePort,
} from "../vendor/bb-canvas/lib/canvas-threads";
import type { CanvasLayer } from "../vendor/bb-canvas/lib/layer";
import type { CanvasNode } from "../vendor/bb-canvas/lib/types";

type State = { layer: CanvasLayer } | { error: string } | null;
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

async function loadChildren(sdk: Sdk, node: CanvasNode) {
  const { threadId, turnId, sourceSeqStart, sourceSeqEnd } = node.meta ?? {};
  if (typeof threadId !== "string") return { nodes: [] };
  if (node.kind === "thread") {
    const response = await sdk.threads.timeline({ threadId });
    const result = timelineToCanvas(threadId, { rows: response.rows as unknown as readonly TimelineRowLike[] });
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

function withStatus(layer: CanvasLayer, threadId: string, status: string): CanvasLayer {
  const id = threadNodeId(threadId);
  return {
    ...layer,
    nodes: layer.nodes.map((node) => (node.id === id ? { ...node, status: threadStatus(status), meta: { ...node.meta, state: status } } : node)),
  };
}

export function CanvasPage(_props: { subPath?: string }) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [state, setState] = useState<State>(null);
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
        if (!cancelled) setState({ layer: threadTree(projectList, threads as unknown as readonly ThreadListItem[]) });
      },
      (cause: unknown) => {
        if (!cancelled) setState({ error: cause instanceof Error ? cause.message : String(cause) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  useEffect(
    () =>
      sdk.subscribe({
        event: "thread:changed",
        callback: (event) => {
          const threadId = event.id;
          if (!threadId) return;
          const status = eventStatus(event);
          if (status) setState((prev) => (prev && "layer" in prev ? { layer: withStatus(prev.layer, threadId, status) } : prev));
          const id = threadNodeId(threadId);
          setReloads((prev) => new Map(prev).set(id, (prev.get(id) ?? 0) + 1));
        },
      }),
    [sdk],
  );

  if (state === null) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if ("error" in state) return <div className="p-4 text-sm text-destructive">Canvas not available: {state.error}</div>;
  if (state.layer.nodes.length === 0) return <div className="p-4 text-sm text-muted-foreground">No threads yet.</div>;
  return (
    <CanvasView
      nodes={state.layer.nodes}
      edges={state.layer.edges}
      initialExpanded={new Set(state.layer.expanded)}
      surface="canvas"
      // A thread always has turns to fetch; a turn only if it has steps.
      canLoadChildren={(node) =>
        (node.kind === "thread" && typeof node.meta?.threadId === "string") ||
        (node.kind === "turn" && typeof node.meta?.summaryCount === "number" && node.meta.summaryCount > 0)
      }
      loadChildren={(node) => loadChildren(sdk, node)}
      reloadChildren={reloads}
      onOpenThread={(threadId) => navigate.toThread(threadId)}
      className="h-full"
    />
  );
}
