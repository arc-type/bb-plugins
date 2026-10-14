// What each node of a run is doing, as the canvas colours it.
//
// The node_run rows only know about nodes that start a worker or a command.
// Everything else — an approval, a note, a subgraph — never gets a row, and
// read from the rows alone it stayed grey for the whole run: a track card
// whose inner steps were all busy looked untouched, and a checkpoint that had
// been answered went back to looking unanswered. The run state knows better
// (`visits`, `outputs`), and a subgraph's state is what its own nodes are
// doing. This module puts the three sources together, once, for every place
// that draws a run: the panel, the card and banner in the chat, the canvas
// page.
//
// Pure, so each rule below has a test, and so the surfaces cannot drift apart
// on what "done" means.
import {
  END_NODE,
  fanOutProgress,
  routeAll,
  type Graph,
  type GraphNode,
  type GraphResolver,
  type RunState,
} from "./graph";

export type NodeVisualStatus = "idle" | "running" | "done" | "failed" | "waiting";

type RunStatus = "running" | "stopping" | "waiting-human" | "done" | "failed" | "stopped";

/** The slice of a run this needs — `RunDto` fits, and so does a test literal. */
export type StatusRun = {
  graph: Graph;
  status: RunStatus;
  state: Pick<RunState, "visits" | "outputs"> & Partial<RunState>;
  nodeRuns: ReadonlyArray<{
    nodeId: string;
    status: "running" | "done" | "failed" | "skipped";
    endedAt?: number | null;
  }>;
  pendingQuestion: { nodeId: string } | null;
  /** The graphs the run's graph embeds (`RunDto.embedded`). */
  embedded?: Graph[];
};

export type RunStatuses = {
  /** Per node id, embedded graphs' nodes included; missing means idle. */
  statuses: Record<string, NodeVisualStatus>;
  /**
   * What a card says instead of the bare status word, where there is more to
   * say — today only subgraph nodes, which name the step inside that is
   * running, waiting or failed, or how far the graph got.
   */
  texts: Record<string, string>;
};

/**
 * The graphs a run embeds, then whatever else the caller can resolve. The
 * run's own list comes first: it is what the server resolved for exactly this
 * run, while the caller's library may not hold a generated graph at all.
 */
export function runResolver(run: Pick<StatusRun, "embedded">, fallback?: GraphResolver): GraphResolver {
  const own = new Map((run.embedded ?? []).map((graph) => [graph.id, graph]));
  return (id) => own.get(id) ?? fallback?.(id) ?? null;
}

/** A run that can still move: anything not running now is only between steps. */
function isLive(status: RunStatus): boolean {
  return status === "running" || status === "stopping";
}

/**
 * The inner step's label as the subgraph card shows it. A compiled track
 * labels its steps "DEMO-2 · implement" inside a card already called
 * "DEMO-2 · greet.sh", so the shared lead is dropped; any other label stays
 * whole.
 */
function stepLabel(outer: GraphNode, inner: GraphNode): string {
  const lead = (label: string) => {
    const at = label.indexOf(" · ");
    return at === -1 ? null : label.slice(0, at);
  };
  const shared = lead(outer.label);
  return shared !== null && lead(inner.label) === shared
    ? inner.label.slice(shared.length + 3)
    : inner.label;
}

export function runStatuses(run: StatusRun, resolve: GraphResolver = () => null): RunStatuses {
  const statuses: Record<string, NodeVisualStatus> = {};
  const texts: Record<string, string> = {};
  const state = run.state;
  const visits = state.visits ?? {};
  const outputs = state.outputs ?? {};

  // Latest attempt per node, and when it ended — the rows arrive in start
  // order, so the last one read is the newest.
  const latest = new Map<string, { status: string; endedAt: number | null }>();
  for (const row of run.nodeRuns) {
    latest.set(row.nodeId, { status: row.status, endedAt: row.endedAt ?? null });
  }

  const own = (node: GraphNode): NodeVisualStatus => {
    if (run.pendingQuestion?.nodeId === node.id) return "waiting";
    const row = latest.get(node.id);
    if (row) {
      if (row.status === "running") return "running";
      if (row.status === "failed") return "failed";
      if (row.status === "done") return "done";
      return "idle";
    }
    // No row: an approval, a note — or a worker node that has not run. The
    // state's visit count is written when the node returns, so it means
    // "went through here"; an approval's answer lands in `outputs` with it.
    if ((visits[node.id] ?? 0) > 0) return "done";
    if (node.kind === "human" && outputs[node.id] !== undefined) return "done";
    return "idle";
  };

  /**
   * Whether an embedded graph got to its End. Two signs, either is enough:
   * a node whose every way out leads to End has finished — the sure one,
   * and the only one for a row-less last step such as a note — or the inner
   * node that finished last routes nowhere under the run's state, which
   * covers a graph that ends on a condition ("approved → End"). Read from
   * the current state, which is the state that last node routed on unless
   * something later overwrote its fields; inside one embedded graph nothing
   * runs after its last node, so that is the honest reading. A finished run
   * settles the rest: whatever ran inside it is over.
   */
  const reachedEnd = (child: Graph): boolean => {
    if (run.status === "done" && child.nodes.some((node) => statuses[node.id] !== "idle")) {
      return true;
    }
    for (const node of child.nodes) {
      const out = child.edges.filter((edge) => edge.from === node.id);
      const terminal = out.every((edge) => edge.to === END_NODE);
      if (terminal && statuses[node.id] === "done") return true;
    }
    let last: { id: string; endedAt: number } | null = null;
    for (const node of child.nodes) {
      const row = latest.get(node.id);
      if (row?.status !== "done" || row.endedAt === null) continue;
      if (!last || row.endedAt > last.endedAt) last = { id: node.id, endedAt: row.endedAt };
    }
    if (!last) return false;
    const full = { ...emptyStateLike(), ...state } as RunState;
    return routeAll(child, last.id, full).next.length === 0;
  };

  const subgraph = (node: GraphNode, child: Graph) => {
    const inner = child.nodes.map((entry) => ({ entry, status: statuses[entry.id] ?? "idle" }));
    const pick = (status: NodeVisualStatus) => inner.filter((entry) => entry.status === status);
    // Waiting before running: a question inside is the one thing on this card
    // the reader has to act on, and in a track the two never happen at once.
    const waiting = pick("waiting");
    if (waiting.length > 0) {
      statuses[node.id] = "waiting";
      texts[node.id] = `waiting · ${stepLabel(node, waiting[0]!.entry)}`;
      return;
    }
    const running = pick("running");
    if (running.length > 0) {
      statuses[node.id] = "running";
      texts[node.id] =
        stepLabel(node, running[0]!.entry) + (running.length > 1 ? ` +${running.length - 1}` : "");
      return;
    }
    const ran = inner.filter((entry) => entry.status !== "idle").length;
    if (ran > 0 && reachedEnd(child)) {
      statuses[node.id] = "done";
      return;
    }
    // A failed step inside is the subgraph's failure only once the run is
    // over: while it still moves, the failure was routed onward (`onError:
    // route`) or is about to end the run, which then says so itself.
    const failed = pick("failed");
    if (failed.length > 0 && (run.status === "failed" || run.status === "stopped")) {
      statuses[node.id] = "failed";
      texts[node.id] = `failed · ${stepLabel(node, failed[0]!.entry)}`;
      return;
    }
    if (ran === 0) return;
    // Started, not finished, nothing busy inside: between two steps of a live
    // run, or parked while the run waits on a question elsewhere.
    statuses[node.id] = isLive(run.status) ? "running" : "idle";
    texts[node.id] = `${ran} of ${child.nodes.length} steps`;
  };

  const walk = (graph: Graph, trail: string[]) => {
    for (const node of graph.nodes) {
      if (node.kind !== "subgraph") {
        statuses[node.id] = own(node);
        continue;
      }
      const child = resolve(node.graphId);
      // A circle is the validator's to report; here it only must not recurse.
      if (!child || trail.includes(child.id)) {
        statuses[node.id] = "idle";
        continue;
      }
      walk(child, [...trail, child.id]);
      subgraph(node, child);
    }
    // A fanned-out node has one row per branch and the last row read wins,
    // so three of seven finished can read as "done". The branch count, from
    // what the branches wrote into the state, knows better.
    const full = { ...emptyStateLike(), ...state } as RunState;
    for (const [nodeId, progress] of Object.entries(fanOutProgress(graph, full))) {
      if (statuses[nodeId] === "failed") continue;
      statuses[nodeId] = progress.done < progress.total ? "running" : "done";
    }
  };

  walk(run.graph, [run.graph.id]);
  for (const [id, status] of Object.entries(statuses)) {
    if (status === "idle" && texts[id] === undefined) delete statuses[id];
  }
  return { statuses, texts };
}

/** The parts of a run state a stored state may lack. */
function emptyStateLike(): RunState {
  return {
    input: "",
    outputs: {},
    fields: {},
    collected: {},
    errors: {},
    item: "",
    threads: {},
    visits: {},
    steps: 0,
  };
}

/** Node ids the run has reached, by the derived status — for edge highlighting. */
export function reachedNodes(statuses: Record<string, NodeVisualStatus>): Set<string> {
  return new Set(
    Object.entries(statuses)
      .filter(([, status]) => status !== "idle")
      .map(([id]) => id),
  );
}

/**
 * Fallback nodes (`path: "fallback"`) a run has not reached, which a run view
 * leaves out of the drawing until asked. "Not reached" is the derived status:
 * anything but idle means the run went there, and then the reader needs to
 * see it — an answered "needs you", a resolver that ran.
 */
export function unreachedFallbacks(
  graph: Graph,
  statuses: Record<string, NodeVisualStatus>,
): Set<string> {
  return new Set(
    graph.nodes
      .filter((node) => node.path === "fallback" && (statuses[node.id] ?? "idle") === "idle")
      .map((node) => node.id),
  );
}
