// The shared canvas page (BBP-131 WI4), crew's own copy: shown only while
// Graph Studio is not active — see `canvasPage` in lib/canvas-layer.ts and
// `server.ts`. Graph Studio's own copy (bb-plugin-graph-studio/components/
// canvas-page.tsx) pulls crew's layer in through RPC and is the one page
// visible whenever both plugins are installed.
import { useEffect, useState } from "react";
import { useBbContext, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
import { withRoots } from "../vendor/bb-canvas/lib/layer";
import type { CanvasEdge, CanvasNode } from "../vendor/bb-canvas/lib/types";
import { threadNodeFor, timelineToCanvas, type TimelineRowLike } from "../lib/canvas-threads";
import type { rpcContract } from "../server";

function withThreadNodes(nodes: readonly CanvasNode[]): CanvasNode[] {
  const threads = nodes.flatMap((node) => {
    const thread = threadNodeFor(node);
    return thread ? [thread] : [];
  });
  return [...nodes, ...threads];
}

type Layer = { nodes: CanvasNode[]; edges: CanvasEdge[]; expanded: Set<string> };

export function CanvasPage() {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const ctx = useBbContext();
  const projectId = ctx.projectId ?? null;
  const [visible, setVisible] = useState<boolean | null>(null);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.call("canvasPage", {}).then(
      (result) => {
        if (!cancelled) setVisible(result.visible);
      },
      () => {
        // Unsure whether graph-studio is there: showing this page beats showing none.
        if (!cancelled) setVisible(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  useEffect(() => {
    if (projectId === null || visible !== true) return;
    let cancelled = false;
    setLayer(null);
    Promise.all([
      rpc.call("canvasLayer", { projectId }),
      sdk.projects.get({ projectId }).then(
        (project) => project.name ?? projectId,
        () => projectId,
      ),
    ]).then(
      ([result, projectLabel]) => {
        if (cancelled) return;
        const page = withRoots(projectId, projectLabel, { nodes: result.nodes, edges: result.edges, expanded: result.expanded });
        setLayer({ nodes: withThreadNodes(page.nodes), edges: [...page.edges], expanded: new Set(page.expanded) });
        setError(null);
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, visible]);

  if (visible === null) return null;
  if (!visible) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Graph Studio provides this page while it is installed.
      </div>
    );
  }
  if (projectId === null) {
    return <div className="p-4 text-sm text-muted-foreground">Open a project to see its canvas.</div>;
  }
  if (error) {
    return <div className="p-4 text-sm text-destructive">Canvas not available: {error}</div>;
  }
  if (layer === null) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <CanvasView
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
      className="h-full"
    />
  );
}
