// The shared canvas page (BBP-131 WI4): one navigation tree for crews and
// graph runs together, built on the vendored `bb-canvas` package. Graph
// Studio owns this page whenever it is active — see `app.tsx` — and pulls
// crew's layer in through the `canvasLayer` RPC, server-side. Being the page
// BB actually shows, it is also the one that live-reloads (BBP-197).
import { useEffect, useMemo, useState } from "react";
import { useBbContext, useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
import { ProjectFilter } from "../vendor/bb-canvas/components/ProjectFilter";
import { mergeLayers, projectOfCrew } from "../vendor/bb-canvas/lib/layer";
import {
  initialProjectFilter,
  loadProjectFilter,
  saveProjectFilter,
  visibleProjectIds,
  type ProjectOption,
} from "../vendor/bb-canvas/lib/project-filter";
import type { CanvasEdge, CanvasNode } from "../vendor/bb-canvas/lib/types";
import { startVisiblePoll } from "../vendor/bb-canvas/lib/visible-poll";
import { threadNodeFor, timelineToCanvas, turnDetailsToCanvas, type TimelineRowLike } from "../lib/canvas-threads";
import { loadNodeDetails, type ThreadLike } from "../lib/canvas-details";
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

  const choose = (ids: string[]) => {
    setSelected(ids);
    saveProjectFilter(ids);
  };

  useEffect(() => {
    if (shown === null) return;
    let cancelled = false;
    // Only a new project set clears the page; a poll swaps the layer in
    // place, so the view keeps its selection, cards and viewport (BBP-200).
    setLayer(null);
    const load = (initial: boolean) =>
      Promise.all(shown.map((projectId) => rpc.call("canvasLayer", { projectId }))).then(
        (results) => {
          if (cancelled) return;
          // Each project arrives already rooted under `agents`; `mergeLayers`
          // keeps the one `agents` node they share, so they sit side by side.
          const page = mergeLayers(
            ...results.map((result) => ({ nodes: result.nodes, edges: result.edges, expanded: result.expanded })),
          );
          setLayer({
            nodes: withThreadNodes(page.nodes),
            edges: [...page.edges],
            expanded: new Set(page.expanded),
          });
          setError(null);
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
  }, [rpc, shownKey]);

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

  return (
    <CanvasView
      // `initialExpanded` is read once at mount, so a new project set needs a fresh view.
      key={shownKey}
      nodes={layer.nodes}
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
          return timelineToCanvas(threadId, { rows: response.rows as unknown as readonly TimelineRowLike[] });
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
      toolbar={<ProjectFilter projects={projects} selected={selected} onChange={choose} />}
      onOpenThread={(threadId) => navigate.toThread(threadId)}
      onOpenRun={(runId) => openRun(runId)}
      onOpenCrew={(crew) => {
        // BBP-49/185: the thread side panel first, as the crew surfaces do;
        // a surface with none falls back to the nav panel.
        const opened = navigate.openThreadPanel({ actionId: "crew", title: `Crew ${crew}`, params: { crew, projectId: projectOfCrew(layer.nodes, crew) ?? urlProjectId ?? shown?.[0] ?? null } });
        if (!opened) navigate.toPluginPanel("crews");
      }}
      className="h-full"
    />
  );
}
