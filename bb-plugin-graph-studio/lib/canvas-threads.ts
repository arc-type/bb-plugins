// The canvas page's last level (BBP-131 WI4): a crew member's bound thread,
// and — lazily, once that thread node is opened — its turns and tool calls
// from the SDK timeline. Pure mapping, so it is testable without the SDK.
import type { CanvasEdge, CanvasNode } from "../vendor/bb-canvas/lib/types";

export const threadNodeId = (threadId: string): string => `thread:${threadId}`;

/**
 * One thread node per member/run that has a bound thread. Collapsed by
 * default — its turns are not worth the weight until someone asks for them.
 * Returns `null` for a node without a `meta.threadId`, so a caller can map
 * over every node in a layer without filtering first.
 */
export function threadNodeFor(parent: CanvasNode): CanvasNode | null {
  const threadId = parent.meta?.threadId;
  if (typeof threadId !== "string" || threadId === "") return null;
  return { id: threadNodeId(threadId), kind: "thread", label: "Thread", parentId: parent.id, meta: { threadId } };
}

/** The slice of a `ThreadTimelineResponse` row this mapping reads, aligned
 *  with the SDK's `TimelineRow` union (`TimelineTurnRow` | `TimelineSourceRow`,
 *  where the latter is `TimelineConversationRow | TimelineWorkRow |
 *  TimelineSystemRow`): `kind` is `"turn"`, `"conversation"`, `"work"`, or
 *  `"system"`; a `"work"` row's `workKind` discriminates `"tool"` from
 *  `"delegation"` (a subagent spawn) and the rest. */
export type TimelineRowLike = {
  id: string;
  kind: string;
  turnId?: string | null;
  text?: string;
  role?: string;
  status?: string;
  summaryCount?: number;
  /** Where this row sits in the thread's source sequence — a turn row needs
   *  both ends to fetch its own steps via `timelineTurnSummaryDetails`. */
  sourceSeqStart?: number;
  sourceSeqEnd?: number;
  /** A `"turn"` row's own nested rows. The real SDK never populates this —
   *  turn steps are fetched lazily via `timelineTurnSummaryDetails` — but a
   *  caller that already has them (e.g. a future eager page) can still nest them. */
  children?: readonly TimelineRowLike[] | null;
  /** Discriminates a `"work"` row, e.g. `"tool"`, `"delegation"`. */
  workKind?: string;
  /** The tool's name, e.g. `"Bash"`, `"Read"`, `"Task"` for a delegation. */
  toolName?: string;
  /** A delegation (subagent) row's task description. */
  description?: string | null;
  /** A delegation row's own nested rows (`TimelineDelegationWorkRow.childRows`). */
  childRows?: readonly TimelineRowLike[] | null;
  /** A delegation row's final output, shown as a short summary. */
  output?: string;
};

const TURN_STATUS: Record<string, CanvasNode["status"]> = {
  running: "running",
  queued: "waiting",
  done: "done",
  completed: "done",
  failed: "failed",
  skipped: "idle",
};

function truncate(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** A delegation row is the SDK's representation of a spawned subagent. */
function isSubagentRow(row: TimelineRowLike): boolean {
  return row.workKind === "delegation";
}

function rowLabel(row: TimelineRowLike): string {
  if (row.kind === "conversation") return truncate(row.text ?? "(empty)", 48) || "(empty)";
  if (isSubagentRow(row)) return `Agent: ${row.description ?? "(no description)"}`;
  return row.toolName ?? row.kind;
}

/** Builds a row's own canvas node plus, for a subagent spawn, its own
 *  `childRows` flattened alongside it. */
function rowNodes(row: TimelineRowLike, parentId: string): CanvasNode[] {
  const id = `row:${row.id}`;
  const node: CanvasNode = {
    id,
    kind: row.kind === "conversation" ? "turn" : isSubagentRow(row) ? "subagent" : "tool-call",
    label: rowLabel(row),
    parentId,
    meta: {
      rowId: row.id,
      kind: row.kind,
      ...(row.status ? { status: row.status } : {}),
      ...(row.output ? { summary: row.output } : {}),
    },
  };
  const children = (row.childRows ?? []).flatMap((child) => rowNodes(child, id));
  return [node, ...children];
}

/**
 * Converts one page of a thread's timeline into canvas nodes under
 * `threadNodeId(threadId)`. A `"turn"` row's own `children` (its
 * conversation and work rows) become its canvas children; every other
 * top-level row hangs directly off the thread.
 */
export function timelineToCanvas(
  threadId: string,
  response: { rows: readonly TimelineRowLike[] },
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const parent = threadNodeId(threadId);
  const nodes: CanvasNode[] = [];
  for (const row of response.rows) {
    if (row.kind === "turn") {
      const turnNodeId = `row:${row.id}`;
      const summaryCount = row.summaryCount ?? (row.children?.length ?? 0);
      nodes.push({
        id: turnNodeId,
        kind: "turn",
        label: `Turn · ${summaryCount} ${summaryCount === 1 ? "step" : "steps"}`,
        ...(row.status && TURN_STATUS[row.status] ? { status: TURN_STATUS[row.status] } : {}),
        parentId: parent,
        meta: {
          rowId: row.id,
          threadId,
          turnId: row.turnId ?? row.id,
          sourceSeqStart: row.sourceSeqStart,
          sourceSeqEnd: row.sourceSeqEnd,
          summaryCount,
        },
      });
      for (const child of row.children ?? []) nodes.push(...rowNodes(child, turnNodeId));
    } else {
      nodes.push(...rowNodes(row, parent));
    }
  }
  return { nodes, edges: [] };
}

/** Converts a turn's lazily-fetched steps (`timelineTurnSummaryDetails`'s
 *  `rows`) into canvas nodes under the turn's own node id. Same row mapping
 *  as `timelineToCanvas`'s thread-level rows (tool-call, subagent incl.
 *  nested `childRows`) — only the parent differs. */
export function turnDetailsToCanvas(
  turnNodeId: string,
  response: { rows: readonly TimelineRowLike[] },
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return { nodes: response.rows.flatMap((row) => rowNodes(row, turnNodeId)), edges: [] };
}
