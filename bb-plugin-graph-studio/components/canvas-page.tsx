// The shared canvas page (BBP-131 WI4): one navigation tree for crews and
// graph runs together, built on the vendored `bb-canvas` package. Graph
// Studio owns this page whenever it is active — see `app.tsx` — and pulls
// crew's layer in through the `canvasLayer` RPC, server-side.
import { useEffect, useState } from "react";
import { useBbContext, useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
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

/** Projects to pick from when neither the host nor the URL names one. */
function ProjectPicker() {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    sdk.projects.list().then(
      (list) => {
        if (!cancelled) setProjects(list.map((project) => ({ id: project.id, name: project.name ?? project.id })));
      },
      () => {
        if (!cancelled) setProjects([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sdk]);
  return (
    <div className="flex flex-col items-start gap-2 p-4 text-sm">
      <p className="text-muted-foreground">Pick a project to see its canvas.</p>
      {(projects ?? []).map((project) => (
        <button
          key={project.id}
          type="button"
          className="rounded-md px-2 py-1 hover:bg-muted"
          onClick={() => navigate.toPluginPanel("canvas", { subPath: project.id })}
        >
          {project.name}
        </button>
      ))}
    </div>
  );
}

export function CanvasPage({ subPath = "" }: { subPath?: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const ctx = useBbContext();
  // BBP-173: on the nav-panel route the host passes no projectId (measured in
  // BB), so the project also travels as the first subPath segment.
  const projectId = ctx.projectId ?? (subPath.split("/").find((part) => part.length > 0) ?? null);
  const [layer, setLayer] = useState<{ nodes: CanvasNode[]; edges: CanvasEdge[]; expanded: Set<string> } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    setLayer(null);
    rpc.call("canvasLayer", { projectId }).then(
      (result) => {
        if (cancelled) return;
        setLayer({
          nodes: withThreadNodes(result.nodes),
          edges: [...result.edges],
          expanded: new Set(result.expanded),
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
  }, [rpc, projectId]);

  if (projectId === null) {
    return <ProjectPicker />;
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
