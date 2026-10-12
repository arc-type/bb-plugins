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
  | "tool-call"
  | "subagent";

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

export type CuratedField = { label: string; value: string };

/** The `meta` keys worth their own row in the sidebar, per kind, in display
 *  order. Everything else a provider put in `meta` — and every curated key a
 *  provider happened not to set — falls into the collapsed "Details" block
 *  instead of the raw dump this replaces (BBP-185). A kind's node-level
 *  `status` already has its own pill in the header, so it is curated only
 *  for `tool-call`/`subagent`, whose nodes carry no top-level `status`. */
const CURATED_KEYS: Partial<Record<CanvasNodeKind, readonly string[]>> = {
  crew: ["crew", "members", "lead"],
  member: ["address", "role", "lead", "activity"],
  "graph-run": ["graphId", "runId", "started", "steps", "threadId"],
  step: ["nodeId", "attempts"],
  // `state` is the thread's own BB status, loaded on selection; the node-level
  // pill is the status of whatever the thread hangs under, not the thread.
  thread: ["title", "state", "provider", "model", "turns", "created", "updated", "threadId"],
  turn: ["rowId"],
  "tool-call": ["status", "summary"],
  subagent: ["status", "summary"],
};

const FIELD_LABELS: Record<string, string> = {
  threadId: "Thread",
  runId: "Run",
  graphId: "Graph",
  crew: "Crew",
  status: "Status",
  role: "Role",
  lead: "Lead",
  activity: "Activity",
  address: "Address",
  nodeId: "Node",
  attempts: "Attempts",
  rowId: "Row",
  summary: "Summary",
  members: "Members",
  started: "Started",
  steps: "Steps",
  title: "Title",
  state: "Status",
  provider: "Provider",
  model: "Model",
  turns: "Turns",
  created: "Created",
  updated: "Updated",
};

function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key.length > 0 ? key[0].toUpperCase() + key.slice(1) : key;
}

/** Splits a node's `meta` into the fields its kind curates (in the kind's
 *  own order) and everything left over, for the sidebar's main body versus
 *  its collapsed "Details" block. A missing, `null`, or `undefined` value is
 *  dropped rather than shown as `"null"`. */
export function curateMeta(
  kind: CanvasNodeKind,
  meta: Record<string, unknown> | undefined,
): { curated: CuratedField[]; details: CuratedField[] } {
  const entries = meta ?? {};
  const curatedKeys = CURATED_KEYS[kind] ?? [];
  const curated: CuratedField[] = [];
  for (const key of curatedKeys) {
    const value = entries[key];
    if (value === undefined || value === null) continue;
    curated.push({ label: fieldLabel(key), value: String(value) });
  }
  const curatedKeySet = new Set(curatedKeys);
  const details: CuratedField[] = [];
  for (const [key, value] of Object.entries(entries)) {
    if (curatedKeySet.has(key) || value === undefined || value === null) continue;
    details.push({ label: fieldLabel(key), value: String(value) });
  }
  return { curated, details };
}
