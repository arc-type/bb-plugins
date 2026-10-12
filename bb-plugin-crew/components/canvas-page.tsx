// The shared canvas page (BBP-131 WI4), crew's own copy: shown only while
// Graph Studio is not active — see `canvasPage` in lib/canvas-layer.ts and
// `server.ts`. Graph Studio's own copy (bb-plugin-graph-studio/components/
// canvas-page.tsx) pulls crew's layer in through RPC and is the one page
// visible whenever both plugins are installed.
import { useEffect, useMemo, useState } from "react";
import { useBbContext, useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
import { ProjectFilter } from "../vendor/bb-canvas/components/ProjectFilter";
import { mergeLayers, projectOfCrew, withRoots } from "../vendor/bb-canvas/lib/layer";
import {
  initialProjectFilter,
  loadProjectFilter,
  saveProjectFilter,
  visibleProjectIds,
  type ProjectOption,
} from "../vendor/bb-canvas/lib/project-filter";
import type { CanvasEdge, CanvasFrame, CanvasNode } from "../vendor/bb-canvas/lib/types";
import { threadNodeFor, timelineToCanvas, type TimelineRowLike } from "../lib/canvas-threads";
import { loadNodeDetails, type ThreadLike } from "../lib/canvas-details";
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

type Layer = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  expanded: Set<string>;
  frames: CanvasFrame[];
  /** Which project each frame came from — the edit panel needs it. */
  frameProjects: Map<string, string>;
};

/** Every project the filter can offer. If the list cannot be read, the
 *  project the page was opened for is still shown on its own. */
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
        if (cancelled) return;
        if (fallbackId === null) return setProjects([]);
        sdk.projects.get({ projectId: fallbackId }).then(
          (project) => !cancelled && setProjects([{ id: fallbackId, name: project.name ?? fallbackId }]),
          () => !cancelled && setProjects([{ id: fallbackId, name: fallbackId }]),
        );
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
  // BBP-173: on the nav-panel route the host passes no projectId (measured in
  // BB), so the project also travels as the first subPath segment.
  const urlProjectId = ctx.projectId ?? (subPath.split("/").find((part) => part.length > 0) ?? null);
  const projects = useProjectOptions(urlProjectId);
  const [selected, setSelected] = useState<string[]>(() => initialProjectFilter(loadProjectFilter(), urlProjectId));
  const shown = useMemo(() => (projects === null ? null : visibleProjectIds(selected, projects)), [projects, selected]);
  const shownKey = shown?.join("\n") ?? null;
  const [visible, setVisible] = useState<boolean | null>(null);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every crew frame is editable — there is no notion yet of a crew the
  // current user may only view (BBP-170 WI6).
  const editableFrameIds = useMemo(() => new Set((layer?.frames ?? []).map((frame) => frame.id)), [layer]);

  const choose = (ids: string[]) => {
    setSelected(ids);
    saveProjectFilter(ids);
  };

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
    if (shown === null || projects === null || visible !== true) return;
    let cancelled = false;
    // BBP-215: used to `setLayer(null)` here too, which fell through to the
    // "Loading…" branch below and replaced the whole page — including the
    // toolbar's project filter — on every refetch, closing its dropdown.
    // The stale layer now stays on screen until the new one lands; only the
    // very first load (still `null`) hits that branch.
    const labels = new Map(projects.map((project) => [project.id, project.name]));
    Promise.all(
      shown.map((projectId) =>
        rpc.call("canvasLayer", { projectId }).then((result) => ({ projectId, result })),
      ),
    ).then(
      (results) => {
        if (cancelled) return;
        // Each project is its own root under `agents`; `mergeLayers` keeps
        // the one `agents` node they all share.
        const page = mergeLayers(
          ...results.map(({ projectId, result }) =>
            withRoots(projectId, labels.get(projectId) ?? projectId, { nodes: result.nodes, edges: result.edges, expanded: result.expanded }),
          ),
        );
        const frameProjects = new Map<string, string>();
        const frames: CanvasFrame[] = [];
        for (const { projectId, result } of results) {
          for (const frame of result.frames ?? []) {
            if (frameProjects.has(frame.id)) continue;
            frameProjects.set(frame.id, projectId);
            frames.push(frame);
          }
        }
        setLayer({
          nodes: withThreadNodes(page.nodes),
          edges: [...page.edges],
          expanded: new Set(page.expanded),
          frames,
          frameProjects,
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
  }, [rpc, shownKey, visible]);

  if (visible === null) return null;
  if (!visible) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Graph Studio provides this page while it is installed.
      </div>
    );
  }
  if (projects === null) {
    return <div className="p-4 text-sm text-muted-foreground">Loading projects…</div>;
  }
  if (projects.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No projects yet.</div>;
  }
  if (error) {
    return <div className="p-4 text-sm text-destructive">Canvas not available: {error}</div>;
  }
  if (layer === null) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <CanvasView
      // BBP-215: used to be `key={shownKey}`, which also tore down and
      // rebuilt `toolbar` (the project filter) on every check, closing its
      // dropdown. `resetKey` resets only the canvas's own per-project-set
      // state; the toolbar keeps its identity across a filter change.
      resetKey={shownKey}
      nodes={layer.nodes}
      edges={layer.edges}
      frames={layer.frames}
      editableFrameIds={editableFrameIds}
      renderFrameEditor={(frameId) => <CrewFrameEditPanel projectId={layer.frameProjects.get(frameId)!} crew={crewNameFromFrameId(frameId)} />}
      initialExpanded={layer.expanded}
      surface="canvas"
      // Only a thread has children to fetch; every other card without
      // children is a leaf and gets no chevron (BBP-183).
      canLoadChildren={(node) => node.kind === "thread" && typeof node.meta?.threadId === "string"}
      loadChildren={async (node) => {
        if (node.kind !== "thread") return { nodes: [] };
        const threadId = node.meta?.threadId;
        if (typeof threadId !== "string") return { nodes: [] };
        const response = await sdk.threads.timeline({ threadId });
        return timelineToCanvas(threadId, { rows: response.rows as unknown as readonly TimelineRowLike[] });
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
