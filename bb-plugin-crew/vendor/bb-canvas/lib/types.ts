// The domain-free vocabulary every canvas provider speaks. Crew, graph-studio
// and (later) threads each translate their own records into these two shapes;
// this package never imports a domain type in return.

export type CanvasNodeKind =
  | "agents"
  | "project"
  | "crew"
  | "member"
  | "graph-run"
  | "step"
  | "thread"
  | "turn"
  | "tool-call";

export type CanvasStatus = "idle" | "running" | "waiting" | "done" | "failed" | "escalated";

export type CanvasNode = {
  id: string;
  kind: CanvasNodeKind;
  label: string;
  /** Undefined draws a neutral dot — colour by status lands in BBP-146. */
  status?: CanvasStatus;
  /** `null` marks a root. A parent id absent from the node set also roots the
   *  node, rather than throwing — a provider that forgot one ancestor must not
   *  take the rest of the tree down with it. */
  parentId: string | null;
  meta?: Record<string, unknown>;
  /** The frame this node's card sits inside, if any (BBP-165). */
  frameId?: string;
};

/**
 * A visual grouping drawn behind a set of nodes — e.g. a crew's lead and
 * members — rather than a property of a single node. `parentId` nests one
 * frame inside another; `null` roots it, the same convention as `CanvasNode`.
 */
export type CanvasFrame = {
  id: string;
  parentId: string | null;
  label?: string;
};

export type CanvasEdgeVariant = "flow" | "back" | "message";

/** Whether this edge was taken in the current run (solid) or is being taken
 *  right now (animated). Undefined draws exactly as before BBP-146 — a plain
 *  `--border` line. A `message` edge never carries this: that is BBP-97's. */
export type CanvasEdgeState = "now" | "taken";

/**
 * An edge beyond the tree itself: `layoutTree` draws the parent/child line for
 * every visible node on its own, so only the exceptions — a back reference, a
 * message between two nodes that are not parent and child — are declared
 * here.
 */
export type CanvasEdge = {
  from: string;
  to: string;
  variant: CanvasEdgeVariant;
  label?: string;
  count?: number;
  state?: CanvasEdgeState;
};
