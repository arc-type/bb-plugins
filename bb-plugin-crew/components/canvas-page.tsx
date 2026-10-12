// The shared canvas page (BBP-131 WI4), crew's own copy: shown only while
// Graph Studio is not active — see `canvasPage` in lib/canvas-layer.ts and
// `server.ts`. Graph Studio's own copy (bb-plugin-graph-studio/components/
// canvas-page.tsx) pulls crew's layer in through RPC and is the one page
// visible whenever both plugins are installed.
import { useEffect, useMemo, useState } from "react";
import { useBbContext, useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
import { withRoots } from "../vendor/bb-canvas/lib/layer";
import type { CanvasEdge, CanvasFrame, CanvasNode } from "../vendor/bb-canvas/lib/types";
import { threadNodeFor, timelineToCanvas, type TimelineRowLike } from "../lib/canvas-threads";
import { crewNameFromFrameId } from "../lib/canvas-layer";
import { CrewFrameEditPanel } from "./crew-frame-edit-panel";
import type { rpcContract } from "../server";

function withThreadNodes(nodes: readonly CanvasNode[]): CanvasNode[] {
  const threads = nodes.flatMap((node) => {
    const thread = threadNodeFor(node);
    return thread ? [thread] : [];
  });
  return [...nodes, ...threads];
}

type Layer = { nodes: CanvasNode[]; edges: CanvasEdge[]; expanded: Set<string>; frames: CanvasFrame[] };

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
    <div className="flex h-full flex-col items-start gap-1 overflow-y-auto p-4 text-sm">
      <p className="text-muted-foreground">
        {projects === null ? "Loading projects…" : projects.length === 0 ? "No projects yet." : "Pick a project to see its canvas."}
      </p>
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
  const [visible, setVisible] = useState<boolean | null>(null);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every crew frame is editable — there is no notion yet of a crew the
  // current user may only view (BBP-170 WI6).
  const editableFrameIds = useMemo(() => new Set((layer?.frames ?? []).map((frame) => frame.id)), [layer]);

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
        setLayer({
          nodes: withThreadNodes(page.nodes),
          edges: [...page.edges],
          expanded: new Set(page.expanded),
          frames: result.frames ?? [],
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
    return <ProjectPicker />;
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
      frames={layer.frames}
      editableFrameIds={editableFrameIds}
      renderFrameEditor={(frameId) => <CrewFrameEditPanel projectId={projectId} crew={crewNameFromFrameId(frameId)} />}
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
