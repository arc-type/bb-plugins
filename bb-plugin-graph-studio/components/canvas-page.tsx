// The shared canvas page (BBP-131 WI4): one navigation tree for crews and
// graph runs together, built on the vendored `bb-canvas` package. Graph
// Studio owns this page whenever it is active — see `app.tsx` — and pulls
// crew's layer in through the `canvasLayer` RPC, server-side.
import { useEffect, useMemo, useState } from "react";
import { useBbContext, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
import { ProjectFilter } from "../vendor/bb-canvas/components/ProjectFilter";
import { mergeLayers } from "../vendor/bb-canvas/lib/layer";
import {
  initialProjectFilter,
  loadProjectFilter,
  saveProjectFilter,
  visibleProjectIds,
  type ProjectOption,
} from "../vendor/bb-canvas/lib/project-filter";
import type { CanvasEdge, CanvasNode } from "../vendor/bb-canvas/lib/types";
import { threadNodeFor, timelineToCanvas, type TimelineRowLike } from "../lib/canvas-threads";
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
    setLayer(null);
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
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
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
      loadChildren={async (node) => {
        if (node.kind !== "thread") return { nodes: [] };
        const threadId = node.meta?.threadId;
        if (typeof threadId !== "string") return { nodes: [] };
        const response = await sdk.threads.timeline({ threadId });
        return timelineToCanvas(threadId, { rows: response.rows as unknown as readonly TimelineRowLike[] });
      }}
      toolbar={<ProjectFilter projects={projects} selected={selected} onChange={choose} />}
      className="h-full"
    />
  );
}
