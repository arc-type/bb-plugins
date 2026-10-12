// Graph Studio's part of the shared canvas (BBP-131): runs, their steps and
// loops as bb-canvas nodes. Pure, so the mapping is testable without a store.
//
// A run hangs under the crew member whose thread started it (the member node
// ids come from crew's own `canvasLayer`), otherwise under the project. Per
// parent, the newest run and every run still in progress stay visible; older
// finished runs fold into one "+N runs" card. Runs start collapsed — a mini
// card that opens into its steps.
import { EMPTY_LAYER, mergeLayers, projectNodeId, withRoots, type CanvasLayer } from "../vendor/bb-canvas/lib/layer";
import type { CanvasEdge, CanvasNode, CanvasStatus } from "../vendor/bb-canvas/lib/types";
import { END_NODE, START_NODE, type Graph } from "./graph";
import { now, taken } from "./edge-state";
import { layoutGraph } from "./layout";

type RunStatus = "running" | "stopping" | "waiting-human" | "done" | "failed" | "stopped";
type StepStatus = "running" | "done" | "failed" | "skipped";

/** The slice of `RunDto` the canvas needs. */
export type CanvasRun = {
  id: string;
  graph: Graph;
  status: RunStatus;
  threadId: string | null;
  createdAt: number;
  nodeRuns: { nodeId: string; attempt: number; status: StepStatus }[];
};

const RUN_STATUS: Record<RunStatus, CanvasStatus> = {
  running: "running",
  stopping: "running",
  "waiting-human": "waiting",
  done: "done",
  failed: "failed",
  stopped: "idle",
};

const STEP_STATUS: Record<StepStatus, CanvasStatus> = {
  running: "running",
  done: "done",
  failed: "failed",
  skipped: "idle",
};

const inProgress = (run: CanvasRun) => run.status === "running" || run.status === "stopping" || run.status === "waiting-human";

export const runNodeId = (runId: string): string => `graph-run:${runId}`;
const stepNodeId = (runId: string, nodeId: string): string => `step:${runId}:${nodeId}`;

/** `memberByThread`: thread id → member node id, from crew's layer. */
export function graphCanvasLayer(
  projectId: string,
  runs: CanvasRun[],
  memberByThread: ReadonlyMap<string, string>,
): CanvasLayer {
  const layer: CanvasLayer = { nodes: [], edges: [], expanded: [] };
  const parentOf = (run: CanvasRun) =>
    (run.threadId !== null ? memberByThread.get(run.threadId) : undefined) ?? projectNodeId(projectId);

  const byParent = new Map<string, CanvasRun[]>();
  for (const run of runs) {
    const parent = parentOf(run);
    byParent.set(parent, [...(byParent.get(parent) ?? []), run]);
  }

  for (const [parent, group] of byParent) {
    const sorted = [...group].sort((a, b) => b.createdAt - a.createdAt);
    const shown = sorted.filter((run, index) => index === 0 || inProgress(run));
    const folded = sorted.filter((run) => !shown.includes(run));
    for (const run of shown) addRun(layer, run, parent);
    if (folded.length > 0) {
      const more = `more-runs:${parent}`;
      layer.nodes.push({
        id: more,
        kind: "graph-run",
        label: `+${folded.length} runs`,
        parentId: parent,
        meta: { placeholder: true, runIds: folded.map((run) => run.id) },
      });
      for (const run of folded) addRun(layer, run, more);
    }
  }
  return layer;
}

function addRun(layer: CanvasLayer, run: CanvasRun, parentId: string): void {
  const id = runNodeId(run.id);
  layer.nodes.push({
    id,
    kind: "graph-run",
    label: run.graph.name,
    status: RUN_STATUS[run.status],
    parentId,
    meta: { runId: run.id, graphId: run.graph.id, status: run.status, threadId: run.threadId },
  });

  const latest = new Map<string, { attempt: number; status: StepStatus }>();
  for (const step of run.nodeRuns) {
    const seen = latest.get(step.nodeId);
    if (!seen || step.attempt >= seen.attempt) latest.set(step.nodeId, step);
  }
  for (const node of run.graph.nodes) {
    const last = latest.get(node.id);
    const step: CanvasNode = {
      id: stepNodeId(run.id, node.id),
      kind: "step",
      label: node.label,
      ...(last ? { status: STEP_STATUS[last.status] } : {}),
      parentId: id,
      meta: { nodeId: node.id, attempts: last?.attempt ?? 0 },
    };
    layer.nodes.push(step);
  }

  // Only loops are declared: the tree already draws run → step, and forward
  // edges between steps are graph-studio's own detail view.
  // Their state comes from the same derivation the legacy canvas uses, so a
  // skipped attempt never makes a loop "taken" here either.
  const pseudo = new Set([START_NODE, END_NODE]);
  const takenKeys = taken(run);
  const nowKeys = now(run);
  for (const edge of layoutGraph(run.graph).edges) {
    if (!edge.isBack || pseudo.has(edge.from) || pseudo.has(edge.to)) continue;
    const back: CanvasEdge = { from: stepNodeId(run.id, edge.from), to: stepNodeId(run.id, edge.to), variant: "back" };
    if (edge.label) back.label = edge.label;
    if (nowKeys.has(edge.key)) back.state = "now";
    else if (takenKeys.has(edge.key)) back.state = "taken";
    layer.edges.push(back);
  }
}

/**
 * The whole page tree: agents → project → crew's layer, with the runs hung
 * into it. Crew is optional — when `crewLayer` fails (not installed, disabled,
 * crashed) the page still renders, just without the crew level; `crew` says
 * which case the page is in.
 */
export async function canvasPageLayer(args: {
  projectId: string;
  projectLabel: string;
  runs: CanvasRun[];
  crewLayer: () => Promise<CanvasLayer>;
}): Promise<CanvasLayer & { crew: boolean }> {
  let crew: CanvasLayer = EMPTY_LAYER;
  let available = true;
  try {
    crew = await args.crewLayer();
  } catch {
    available = false;
  }
  const memberByThread = new Map<string, string>();
  for (const node of crew.nodes) {
    const threadId = node.kind === "member" ? node.meta?.threadId : undefined;
    if (typeof threadId === "string") memberByThread.set(threadId, node.id);
  }
  const page = withRoots(args.projectId, args.projectLabel, mergeLayers(crew, graphCanvasLayer(args.projectId, args.runs, memberByThread)));
  return { ...page, crew: available };
}
