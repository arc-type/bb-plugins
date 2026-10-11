// Which of a run's edges were actually taken, and which of those are being
// taken right now (BBP-146). Pure and dependency-free beyond the graph
// itself, so the same two functions feed the legacy canvas's
// `travelledEdges`-style highlight and bb-canvas's tree-line state.
//
// `taken` generalizes `travelledEdges` (graph-studio-panel.tsx) with one
// addition: a back edge needs its target's *second* attempt, since the first
// one is what the forward edge into it already claims. `now` is the subset
// of `taken` whose target's latest attempt is still running.
import { edgeKey, START_NODE } from "./graph";
import { layoutGraph } from "./layout";
import type { CanvasRun } from "./canvas-layer";

type NodeRun = CanvasRun["nodeRuns"][number];

/** Every attempt at each node, latest first skip of `skipped` ones — by lead
 *  decision (2026-10-11) a skipped attempt never makes an edge "taken": the
 *  router chose not to go there, it did not try and fail. */
function attemptsByNode(run: CanvasRun): Map<string, NodeRun[]> {
  const byNode = new Map<string, NodeRun[]>();
  for (const nodeRun of run.nodeRuns) {
    if (nodeRun.status === "skipped") continue;
    const list = byNode.get(nodeRun.nodeId) ?? [];
    list.push(nodeRun);
    byNode.set(nodeRun.nodeId, list);
  }
  return byNode;
}

function latestAttempt(attempts: NodeRun[] | undefined): NodeRun | null {
  if (!attempts || attempts.length === 0) return null;
  return attempts.reduce((latest, next) => (next.attempt >= latest.attempt ? next : latest));
}

/** Back edges per `layoutGraph`'s own layering — the same rule the canvas
 *  already draws as an arc, so "which edge needs two attempts" never drifts
 *  from "which edge draws as a loop". */
function backEdgeKeys(run: CanvasRun): Set<string> {
  return new Set(layoutGraph(run.graph).edges.filter((edge) => edge.isBack).map((edge) => edge.key));
}

/** Edges actually taken in this run: the target was attempted, and so was
 *  the source (or the source is the graph's start). A back edge additionally
 *  needs a *second* attempt at its target — the first is already claimed by
 *  the forward edge that led there the first time. */
export function taken(run: CanvasRun): Set<string> {
  const attempts = attemptsByNode(run);
  const back = backEdgeKeys(run);
  const keys = new Set<string>();
  for (const edge of run.graph.edges) {
    const key = edgeKey(edge);
    const toAttempts = attempts.get(edge.to) ?? [];
    if (toAttempts.length === 0) continue;
    // Both kinds need the source attempted: a failed step retried in place
    // has two attempts too, but nothing came back to it over the loop.
    if (edge.from !== START_NODE && (attempts.get(edge.from) ?? []).length === 0) continue;
    if (back.has(key) && toAttempts.length < 2) continue;
    keys.add(key);
  }
  return keys;
}

/** The subset of `taken` whose target's latest (non-skipped) attempt is
 *  running right now. Parallel branches can both be "now" at once. */
export function now(run: CanvasRun): Set<string> {
  const attempts = attemptsByNode(run);
  const takenKeys = taken(run);
  const keys = new Set<string>();
  for (const edge of run.graph.edges) {
    const key = edgeKey(edge);
    if (!takenKeys.has(key)) continue;
    const last = latestAttempt(attempts.get(edge.to));
    if (last?.status === "running") keys.add(key);
  }
  return keys;
}
