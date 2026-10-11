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

/** The slice of a `ThreadTimelineResponse` row this mapping reads — every
 *  row kind, conversation or work, carries at least this much. */
export type TimelineRowLike = {
  id: string;
  kind: string;
  turnId?: string | null;
  text?: string;
  role?: string;
  status?: string;
  summaryCount?: number;
  children?: readonly TimelineRowLike[] | null;
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

function rowLabel(row: TimelineRowLike): string {
  if (row.kind === "conversation") return truncate(row.text ?? "(empty)", 48) || "(empty)";
  return row.kind;
}

function rowNode(row: TimelineRowLike, parentId: string): CanvasNode {
  return {
    id: `row:${row.id}`,
    kind: row.kind === "conversation" ? "turn" : "tool-call",
    label: rowLabel(row),
    parentId,
    meta: { rowId: row.id, kind: row.kind },
  };
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
      const turnId = `row:${row.id}`;
      nodes.push({
        id: turnId,
        kind: "turn",
        label: `Turn · ${row.summaryCount ?? (row.children?.length ?? 0)} ${(row.summaryCount ?? row.children?.length ?? 0) === 1 ? "step" : "steps"}`,
        ...(row.status && TURN_STATUS[row.status] ? { status: TURN_STATUS[row.status] } : {}),
        parentId: parent,
        meta: { rowId: row.id },
      });
      for (const child of row.children ?? []) nodes.push(rowNode(child, turnId));
    } else {
      nodes.push(rowNode(row, parent));
    }
  }
  return { nodes, edges: [] };
}
