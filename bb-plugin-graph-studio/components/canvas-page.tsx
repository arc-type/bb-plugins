// The shared canvas page (BBP-131 WI4): one navigation tree for crews and
// graph runs together, built on the vendored `bb-canvas` package. Graph
// Studio owns this page whenever it is active — see `app.tsx` — and pulls
// crew's layer in through the `canvasLayer` RPC, server-side. Being the page
// BB actually shows, it is also the one that live-reloads (BBP-197).
import { useEffect, useMemo, useRef, useState } from "react";
import { useBbContext, useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
import { ProjectFilter } from "../vendor/bb-canvas/components/ProjectFilter";
import { FocusFilter } from "../vendor/bb-canvas/components/FocusFilter";
import { FocusUnavailable } from "../vendor/bb-canvas/components/FocusUnavailable";
import { mergeLayers, projectOfCrew } from "../vendor/bb-canvas/lib/layer";
import {
  initialProjectFilter,
  loadProjectFilter,
  saveProjectFilter,
  visibleProjectIds,
  type ProjectOption,
} from "../vendor/bb-canvas/lib/project-filter";
import {
  focusPathIds,
  loadFocusFilter,
  missingFocusIds,
  saveFocusFilter,
  visibleFocusIds,
} from "../vendor/bb-canvas/lib/focus-filter";
import type { CanvasEdge, CanvasNode } from "../vendor/bb-canvas/lib/types";
import { startVisiblePoll } from "../vendor/bb-canvas/lib/visible-poll";
import {
  enrichThreadNodes,
  enrichTurnNodes,
  threadNodeFor,
  timelineToCanvas,
  turnDetailsToCanvas,
  type ThreadTitlePort,
  type TimelineRowLike,
  type TurnFirstLinePort,
} from "../vendor/bb-canvas/lib/canvas-threads";
import { loadNodeDetails, type ThreadLike } from "../vendor/bb-canvas/lib/canvas-details";
import { useOpenRun } from "./run-card";
import type { rpcContract } from "../server";

/** Every member/run node gets its bound thread as a (collapsed) child —
 *  cheap, since it is just one more node, unlike the timeline fetch behind it. */
function withThreadNodes(nodes: readonly CanvasNode[]): CanvasNode[] {
  const threads = nodes.flatMap((node) => {
    const thread = threadNodeFor(node);
    return thread ? [thread] : [];
  });
  return [...nodes, ...threads];
}

/** Builds the port `enrichThreadNodes` needs from the SDK the page already
 *  has — the first user message is only ever fetched for a thread with no
 *  title of its own. */
function threadTitlePort(sdk: ReturnType<typeof useSdk>): ThreadTitlePort {
  return {
    get: async (threadId) => (await sdk.threads.get({ threadId })) as unknown as ThreadLike,
    firstUserMessage: async (threadId) => {
      const response = await sdk.threads.timeline({ threadId });
      const rows = response.rows as unknown as readonly { kind: string; role?: string; text?: string }[];
      return rows.find((row) => row.kind === "conversation" && row.role === "user")?.text;
    },
  };
}

/** Builds the port `enrichTurnNodes` needs: the same lazy fetch
 *  `loadChildren` uses to expand a turn on click, just triggered eagerly so
 *  a turn's card shows its first line without waiting for that (BBP-206 R2b). */
function turnFirstLinePort(sdk: ReturnType<typeof useSdk>): TurnFirstLinePort {
  return {
    turnDetails: async (turnId, threadId, sourceSeqStart, sourceSeqEnd) => {
      const response = await sdk.threads.timelineTurnSummaryDetails({
        threadId,
        turnId,
        sourceSeqStart: String(sourceSeqStart),
        sourceSeqEnd: String(sourceSeqEnd),
      });
      return { rows: response.rows as unknown as readonly TimelineRowLike[] };
    },
  };
}

/** Carries a thread node's own enrichment (title/state/provider) over from
 *  the previous poll's result onto this poll's freshly built node of the
 *  same id — a poll rebuilds every node from scratch, so without this every
 *  thread is re-fetched every 5s (`POLL_MS`) forever, rather than once.
 *  `enrichThreadNodes`'s own already-enriched check (state/provider present)
 *  would skip the re-fetch regardless, but carrying the result over here
 *  means the title is on screen immediately, not just after this poll's
 *  fetch resolves. (A turn's first line has no page-level equivalent of this
 *  — see `loadChildren`'s own `enrichTurnNodes` call instead.) */
function carryOverEnrichment(freshNodes: readonly CanvasNode[], previous: readonly CanvasNode[]): CanvasNode[] {
  const previousById = new Map(previous.map((node) => [node.id, node]));
  return freshNodes.map((node) => {
    if (node.kind !== "thread") return node;
    const known = previousById.get(node.id);
    if (!known || (known.meta?.state === undefined && known.meta?.provider === undefined)) return node;
    return { ...node, label: known.label, meta: { ...node.meta, ...known.meta } };
  });
}

/** Every project the filter can offer. If the list cannot be read, the
 *  project the page was opened for is still shown on its own — its label
 *  comes from the server's layer either way. */
function useProjectOptions(fallbackId: string | null): ProjectOption[] | null {
  const sdk = useSdk();
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    sdk.projects.list().then(
      (list) => {
        if (!cancelled) setProjects(list.map((project) => ({ id: project.id, name: project.name ?? project.id })));
      },
      () => {
        if (!cancelled) setProjects(fallbackId === null ? [] : [{ id: fallbackId, name: fallbackId }]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sdk, fallbackId]);
  return projects;
}

export function CanvasPage({ subPath = "" }: { subPath?: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const ctx = useBbContext();
  const navigate = useBbNavigate();
  const openRun = useOpenRun();
  // BBP-173: on the nav-panel route the host passes no projectId (measured in
  // BB), so the project also travels as the first subPath segment.
  const urlProjectId = ctx.projectId ?? (subPath.split("/").find((part) => part.length > 0) ?? null);
  const projects = useProjectOptions(urlProjectId);
  const [selected, setSelected] = useState<string[]>(() => initialProjectFilter(loadProjectFilter(), urlProjectId));
  const shown = useMemo(() => (projects === null ? null : visibleProjectIds(selected, projects)), [projects, selected]);
  const shownKey = shown?.join("\n") ?? null;
  const [layer, setLayer] = useState<{ nodes: CanvasNode[]; edges: CanvasEdge[]; expanded: Set<string> } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  // The last fully-known node list, kept outside state so `load` can read it
  // synchronously on the very next poll without becoming an effect
  // dependency (BBP-206 R3) — see `carryOverEnrichment`.
  const enrichedNodesRef = useRef<readonly CanvasNode[]>([]);

  const choose = (ids: string[]) => {
    setSelected(ids);
    saveProjectFilter(ids);
  };

  const [focusSelected, setFocusSelected] = useState<string[]>(() => loadFocusFilter());
  const chooseFocus = (ids: string[]) => {
    setFocusSelected(ids);
    saveFocusFilter(ids);
  };
  const toggleFocus = (id: string) =>
    chooseFocus(focusSelected.includes(id) ? focusSelected.filter((other) => other !== id) : [...focusSelected, id]);
  // BBP-197: a live-update poll must not reset the focus — it is plain React
  // state here, untouched by the layer-loading effect below.
  const missingFocused = useMemo(
    () => (layer ? missingFocusIds(layer.nodes, focusSelected) : []),
    [layer, focusSelected],
  );
  const allFocusedMissing = focusSelected.length > 0 && missingFocused.length === focusSelected.length;
  const visibleFocused = useMemo(
    () => (layer ? visibleFocusIds(layer.nodes, focusSelected) : new Set<string>()),
    [layer, focusSelected],
  );
  const focusDimmed = useMemo(
    () => (layer ? focusPathIds(layer.nodes, focusSelected) : new Set<string>()),
    [layer, focusSelected],
  );

  useEffect(() => {
    if (shown === null) return;
    let cancelled = false;
    // BBP-215: used to `setLayer(null)` here too, which fell through to the
    // "Loading…" branch below and replaced the whole page — including the
    // toolbar's project filter — on every refetch, closing its dropdown.
    // The stale layer now stays on screen until the new one lands; only the
    // very first load (still `null`) hits that branch. A poll likewise swaps
    // the layer in place, so the view keeps its selection, cards and
    // viewport (BBP-200).
    enrichedNodesRef.current = [];
    const load = (initial: boolean) =>
      Promise.all(shown.map((projectId) => rpc.call("canvasLayer", { projectId }))).then(
        (results) => {
          if (cancelled) return;
          // Each project arrives already rooted under `agents`; `mergeLayers`
          // keeps the one `agents` node they share, so they sit side by side.
          const page = mergeLayers(
            ...results.map((result) => ({ nodes: result.nodes, edges: result.edges, expanded: result.expanded })),
          );
          const nodes = carryOverEnrichment(withThreadNodes(page.nodes), enrichedNodesRef.current);
          enrichedNodesRef.current = nodes;
          setLayer({
            nodes,
            edges: [...page.edges],
            expanded: new Set(page.expanded),
          });
          setError(null);
          // Thread title/state/provider only — a turn's first line is
          // enriched in `loadChildren` instead, the moment its node exists
          // (BBP-206 R3); this page-level pass never sees turn nodes at all.
          void enrichThreadNodes(page.nodes, nodes, threadTitlePort(sdk)).then((afterThreads) => {
            enrichedNodesRef.current = afterThreads;
            if (!cancelled) setLayer((prev) => (prev ? { ...prev, nodes: afterThreads } : prev));
          });
        },
        (cause: unknown) => {
          // A failed poll keeps the last good tree on screen; only the
          // first load has nothing better to show than the error.
          if (!cancelled && initial) setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    void load(true);
    const stopPolling = startVisiblePoll(() => void load(false));
    return () => {
      cancelled = true;
      stopPolling();
    };
    // `shownKey` stands in for `shown`, which is a fresh array on every filter change.
  }, [rpc, sdk, shownKey]);

  if (projects === null) {
    return <div className="p-4 text-sm text-muted-foreground">Loading projects…</div>;
  }
  if (projects.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No projects yet.</div>;
  }
  if (error) {
    return <div className="p-4 text-sm text-destructive">Canvas not available: {error}</div>;
  }
  // `CanvasView` seeds its `expanded` state from `initialExpanded` once, at
  // mount — so it only mounts once the real layer (and its real starting
  // set) is in, instead of once with an empty one it would never revisit.
  if (layer === null) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }
  if (allFocusedMissing) {
    return <FocusUnavailable onShowAll={() => chooseFocus([])} />;
  }
  const shownNodes = layer.nodes.filter((node) => visibleFocused.has(node.id));

  return (
    <CanvasView
      // BBP-215: used to be `key={shownKey}`, which also tore down and
      // rebuilt `toolbar` (the project filter) on every check, closing its
      // dropdown. `resetKey` resets only the canvas's own per-project-set
      // state; the toolbar keeps its identity across a filter change.
      resetKey={shownKey}
      nodes={shownNodes}
      onToggleFocus={toggleFocus}
      focusPathIds={focusDimmed}
      focusSelected={focusSelected}
      edges={layer.edges}
      initialExpanded={layer.expanded}
      surface="canvas"
      // A thread always has children to fetch; a turn only if it has steps
      // (`summaryCount > 0`) — every other card without children is a leaf
      // and gets no chevron (BBP-183).
      canLoadChildren={(node) =>
        (node.kind === "thread" && typeof node.meta?.threadId === "string") ||
        (node.kind === "turn" && typeof node.meta?.summaryCount === "number" && node.meta.summaryCount > 0)
      }
      loadChildren={async (node) => {
        if (node.kind === "thread") {
          const threadId = node.meta?.threadId;
          if (typeof threadId !== "string") return { nodes: [] };
          const response = await sdk.threads.timeline({ threadId });
          const result = timelineToCanvas(threadId, { rows: response.rows as unknown as readonly TimelineRowLike[] });
          // A turn row never carries its own first line on this page (BBP-206
          // R3: turn `children` is always null here); enrich it the moment
          // its node is created. A page-level poll pass can't do this — turn
          // nodes live only in CanvasView's own `loaded` state once expanded,
          // never in `layer.nodes`, so it would never find any to enrich.
          const nodes = await enrichTurnNodes(result.nodes, turnFirstLinePort(sdk));
          return { ...result, nodes };
        }
        if (node.kind === "turn") {
          const { threadId, turnId, sourceSeqStart, sourceSeqEnd } = node.meta ?? {};
          if (
            typeof threadId !== "string" ||
            typeof turnId !== "string" ||
            typeof sourceSeqStart !== "number" ||
            typeof sourceSeqEnd !== "number"
          ) {
            return { nodes: [] };
          }
          const response = await sdk.threads.timelineTurnSummaryDetails({
            threadId,
            turnId,
            sourceSeqStart: String(sourceSeqStart),
            sourceSeqEnd: String(sourceSeqEnd),
          });
          return turnDetailsToCanvas(node.id, { rows: response.rows as unknown as readonly TimelineRowLike[] }, threadId);
        }
        return { nodes: [] };
      }}
      // BBP-179: a thread's sidebar shows BB's status, provider, model, times
      // and turn count, not just its id — loaded once, on first selection.
      loadDetails={(node) =>
        loadNodeDetails(
          {
            get: async (threadId) => (await sdk.threads.get({ threadId })) as unknown as ThreadLike,
            model: async (threadId) => (await sdk.threads.defaultExecutionOptions({ threadId }))?.model ?? null,
            timelineRows: async (threadId) => (await sdk.threads.timeline({ threadId })).rows as unknown as readonly { kind: string }[],
          },
          node,
        )
      }
      toolbar={
        <>
          <ProjectFilter projects={projects} selected={selected} onChange={choose} />
          <FocusFilter nodes={layer.nodes} selected={focusSelected} onChange={chooseFocus} />
        </>
      }
      onOpenThread={(threadId) => navigate.toThread(threadId)}
      onOpenRun={(runId) => openRun(runId)}
      // BB's navigate API has no way yet to open a thread scrolled to a
      // specific row (BBP-206); this opens the thread itself, the closest
      // `onOpenAtRow` can get until the SDK can address one.
      onOpenAtRow={(threadId) => navigate.toThread(threadId)}
      onOpenCrew={(crew) => {
        // BBP-49/185: the thread side panel first, as the crew surfaces do;
        // a surface with none falls back to the nav panel.
        const opened = navigate.openThreadPanel({ actionId: "crew", title: `Crew ${crew}`, params: { crew, projectId: projectOfCrew(layer.nodes, crew) ?? urlProjectId ?? shown?.[0] ?? null } });
        if (!opened) navigate.toPluginPanel("crews");
      }}
      onFocusThis={(id) => chooseFocus([id])}
      className="h-full"
    />
  );
}
