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
export function threadNodeFor(parent: CanvasNode, info: ThreadInfo = {}): CanvasNode | null {
  const threadId = parent.meta?.threadId;
  if (typeof threadId !== "string" || threadId === "") return null;
  const title = info.title?.trim() ?? "";
  const firstMessage = truncate(info.firstUserMessage ?? "", 48);
  return {
    id: threadNodeId(threadId),
    kind: "thread",
    label: title || firstMessage || "Thread",
    parentId: parent.id,
    meta: compact({ threadId, title, state: info.state, provider: info.provider }),
  };
}

/** What a caller may already know about the thread: its title (the card's
 *  label), else its first user message, plus state and provider. */
export type ThreadInfo = {
  title?: string | null;
  firstUserMessage?: string | null;
  state?: string | null;
  provider?: string | null;
};

/** Drops `undefined`, `null` and `""` so the sidebar never shows an empty
 *  field (its `curateMeta` only drops `undefined`/`null`). */
function compact(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined && value !== null && value !== ""));
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
  /** A `"system"` row's own fields. */
  title?: string;
  detail?: string;
  /** e.g. `error`, `operation`, `warning`, `deprecation`, `debug`, `reconnect`. */
  systemKind?: string;
  /** e.g. `context_clear`, `compaction`, `parent-change`. */
  operationKind?: string;
  oldParentId?: string;
  newParentId?: string;
  /** A `"work"` row's own fields. */
  toolArgs?: unknown;
  outputPreview?: string;
  exitCode?: number;
  startedAt?: string;
  completedAt?: string;
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

/** A tool call's arguments as one short string: the command if there is
 *  one, else the arguments as JSON. Empty when there are none. */
function argsText(args: unknown): string {
  if (args === undefined || args === null || args === "") return "";
  if (typeof args === "string") return args;
  if (typeof args === "object" && typeof (args as { command?: unknown }).command === "string") {
    return (args as { command: string }).command;
  }
  return JSON.stringify(args) ?? "";
}

/** The file a tool call touches, if its arguments name one. */
function argsFileName(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  const path = record.file_path ?? record.path ?? record.notebook_path;
  return typeof path === "string" ? (path.split("/").pop() ?? "") : "";
}

function duration(startedAt?: string, completedAt?: string): string {
  if (!startedAt || !completedAt) return "";
  const ms = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function rowLabel(row: TimelineRowLike): string {
  if (row.kind === "conversation") return truncate(row.text ?? "(empty)", 48) || "(empty)";
  if (isSubagentRow(row)) return `Agent: ${row.description ?? "(no description)"}`;
  if (row.toolName) return row.toolName;
  if (row.kind === "work") {
    const fromArgs = (args: unknown) =>
      typeof args === "object" && args !== null && typeof (args as { command?: unknown }).command === "string"
        ? argsText(args)
        : argsFileName(args) || argsText(args);
    return truncate(fromArgs(row.toolArgs), 48) || row.kind;
  }
  return row.kind;
}

function workMeta(row: TimelineRowLike, threadId: string | undefined): Record<string, unknown> {
  const command = argsText(row.toolArgs);
  const isCommand = typeof row.toolArgs === "string" || typeof (row.toolArgs as { command?: unknown } | null)?.command === "string";
  return compact({
    toolName: row.toolName,
    ...(isCommand ? { command: truncate(command, 200) } : { toolArgs: command }),
    outputPreview: row.outputPreview || (row.output ? truncate(row.output, 200) : ""),
    exitCode: row.exitCode,
    duration: duration(row.startedAt, row.completedAt),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    ...(threadId && typeof row.sourceSeqStart === "number" ? { threadId, sourceSeq: row.sourceSeqStart } : {}),
  });
}

/** Builds a row's own canvas node plus, for a subagent spawn, its own
 *  `childRows` flattened alongside it. */
function rowNodes(row: TimelineRowLike, parentId: string, threadId?: string): CanvasNode[] {
  const id = `row:${row.id}`;
  const isWork = row.kind === "work" && !isSubagentRow(row);
  const failed = isWork && typeof row.exitCode === "number" && row.exitCode !== 0;
  const node: CanvasNode = {
    id,
    kind: row.kind === "conversation" ? "turn" : isSubagentRow(row) ? "subagent" : "tool-call",
    label: rowLabel(row),
    ...(failed ? { status: "failed" as const } : {}),
    parentId,
    meta: {
      rowId: row.id,
      kind: row.kind,
      ...(row.status ? { status: row.status } : {}),
      ...(row.output ? { summary: row.output } : {}),
      ...(isWork ? workMeta(row, threadId) : {}),
    },
  };
  const children = mapRows(row.childRows ?? [], id, threadId);
  return [node, ...children];
}

/** An error, or an operation that says what happened, stands on its own;
 *  every other system row is noise worth one bundled node. */
function isOwnSystemEvent(row: TimelineRowLike): boolean {
  return row.systemKind === "error" || (row.systemKind === "operation" && !!row.detail);
}

function systemEventNode(row: TimelineRowLike, parentId: string): CanvasNode {
  return {
    id: `row:${row.id}`,
    kind: "system-event",
    label: row.title || row.operationKind || row.systemKind || "system event",
    ...(row.systemKind === "error" ? { status: "failed" as const } : {}),
    parentId,
    meta: compact({
      rowId: row.id,
      detail: row.detail,
      ...(row.operationKind === "parent-change" ? { oldParent: row.oldParentId, newParent: row.newParentId } : {}),
    }),
  };
}

function bundledSystemNode(rows: readonly TimelineRowLike[], parentId: string): CanvasNode {
  const titles = rows.map((row) => row.title).filter((title): title is string => !!title);
  return {
    id: `row:${rows[0]!.id}`,
    kind: "system-event",
    label: `${rows.length} system ${rows.length === 1 ? "event" : "events"}`,
    parentId,
    meta: compact({ rowId: rows[0]!.id, ...(titles.length > 0 ? { titles } : {}) }),
  };
}

/** Maps sibling rows, bundling each run of consecutive minor system rows. */
function mapRows(rows: readonly TimelineRowLike[], parentId: string, threadId?: string): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  let bundle: TimelineRowLike[] = [];
  const flush = () => {
    if (bundle.length > 0) nodes.push(bundledSystemNode(bundle, parentId));
    bundle = [];
  };
  for (const row of rows) {
    if (row.kind === "system" && !isOwnSystemEvent(row)) {
      bundle.push(row);
      continue;
    }
    flush();
    nodes.push(...(row.kind === "system" ? [systemEventNode(row, parentId)] : rowNodes(row, parentId, threadId)));
  }
  flush();
  return nodes;
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
  let pending: TimelineRowLike[] = [];
  const flush = () => {
    nodes.push(...mapRows(pending, parent, threadId));
    pending = [];
  };
  for (const row of response.rows) {
    if (row.kind !== "turn") {
      pending.push(row);
      continue;
    }
    flush();
    const turnNodeId = `row:${row.id}`;
    const summaryCount = row.summaryCount ?? (row.children?.length ?? 0);
    const request = row.children?.find((child) => child.kind === "conversation" && child.role === "user");
    const firstLine = truncate(request?.text?.split("\n").find((line) => line.trim() !== "") ?? "", 120);
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
        ...(firstLine ? { firstLine } : {}),
      },
    });
    nodes.push(...mapRows(row.children ?? [], turnNodeId, threadId));
  }
  flush();
  return { nodes, edges: [] };
}

/** Converts a turn's lazily-fetched steps (`timelineTurnSummaryDetails`'s
 *  `rows`) into canvas nodes under the turn's own node id. Same row mapping
 *  as `timelineToCanvas`'s thread-level rows (tool-call, subagent incl.
 *  nested `childRows`) — only the parent differs. */
export function turnDetailsToCanvas(
  turnNodeId: string,
  response: { rows: readonly TimelineRowLike[] },
  threadId?: string,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return { nodes: mapRows(response.rows, turnNodeId, threadId), edges: [] };
}
