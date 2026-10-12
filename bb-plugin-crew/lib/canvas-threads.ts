// The canvas page's last level (BBP-131 WI4): a crew member's bound thread,
// and — lazily, once that thread node is opened — its turns and tool calls
// from the SDK timeline. Pure mapping, so it is testable without the SDK.
import type { CanvasEdge, CanvasNode } from "../vendor/bb-canvas/lib/types";
import { formatTimestamp } from "../vendor/bb-canvas/lib/format";
import type { ThreadLike } from "./canvas-details";

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

/** What `enrichThreadNodes` needs to turn a placeholder thread node into its
 *  real card: the thread itself, and — only when it has no title — its
 *  first user message, for the same fallback `threadNodeFor` applies. */
export type ThreadTitlePort = {
  get: (threadId: string) => Promise<ThreadLike>;
  firstUserMessage: (threadId: string) => Promise<string | undefined>;
};

/** Replaces each placeholder `"Thread"` node (built eagerly by `threadNodeFor`
 *  with no `info`) with one carrying the thread's real title/state/provider,
 *  once that is readable (BBP-206 requirement 3). A thread that cannot be
 *  read, or a node that is not a thread's parent, is left exactly as it was
 *  — this never throws and never drops a node. */
export async function enrichThreadNodes(
  parents: readonly CanvasNode[],
  nodes: readonly CanvasNode[],
  port: ThreadTitlePort,
): Promise<CanvasNode[]> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  await Promise.all(
    parents.map(async (parent) => {
      const threadId = parent.meta?.threadId;
      if (typeof threadId !== "string" || threadId === "") return;
      const id = threadNodeId(threadId);
      if (!byId.has(id)) return;
      try {
        const thread = await port.get(threadId);
        const title = thread.title || thread.titleFallback || undefined;
        const firstUserMessage = title ? undefined : await port.firstUserMessage(threadId).catch(() => undefined);
        const rebuilt = threadNodeFor(parent, {
          title,
          state: thread.displayStatus ?? thread.status,
          provider: thread.providerId,
          firstUserMessage,
        });
        if (rebuilt) byId.set(id, rebuilt);
      } catch {
        // Thread unreadable: the placeholder "Thread" label stands.
      }
    }),
  );
  return nodes.map((node) => byId.get(node.id) ?? node);
}

/** The slice of a `ThreadTimelineResponse` row this mapping reads, aligned
 *  with the SDK's real `TimelineRow` union (verified against the
 *  `@get-bb/plugin-sdk` bundled zod schemas and real samples, BBP-206 R2a/b
 *  — see `bb-canvas/fixtures/real-timeline-rows.json`): `kind` is `"turn"`,
 *  `"conversation"`, `"work"`, or `"system"`. A `"work"` row's `workKind` is
 *  a 16-way discriminated union with *disjoint* fields per kind — this type
 *  only models the four BBP-206 covers (`command`, `tool`, `file-change`,
 *  `delegation`); every other `workKind` falls through to the generic
 *  fallback mapping untouched. */
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
  /** Discriminates a `"work"` row: `"command"` (shell), `"tool"` (MCP/other
   *  tool calls), `"file-change"` (Edit/Write), `"delegation"` (subagent
   *  spawn), or one of 12 other kinds this mapping does not special-case. */
  workKind?: string;
  /** Real Unix-ms timestamps (not strings — BBP-206 R2b correction). */
  startedAt?: number;
  completedAt?: number;
  /** `workKind: "command"` fields: a shell invocation. No `toolName`/`toolArgs`. */
  command?: string;
  cwd?: string;
  exitCode?: number;
  /** `workKind: "tool"` fields: an MCP/other tool call. No `exitCode`/`command`. */
  toolName?: string;
  toolArgs?: unknown;
  /** Shared by `command` and `tool`. */
  output?: string;
  outputPreview?: string;
  /** `workKind: "file-change"` fields: one file edit. No `output`/`exitCode`. */
  change?: {
    path?: string;
    kind?: string;
    movePath?: string | null;
    diffStats?: { added: number; removed: number };
  };
  stdout?: string | null;
  stderr?: string | null;
  /** `workKind: "delegation"` (subagent) row's task description. */
  description?: string | null;
  /** A delegation row's own nested rows (`TimelineDelegationWorkRow.childRows`). */
  childRows?: readonly TimelineRowLike[] | null;
  /** A `"system"` row's own fields. */
  title?: string;
  detail?: string | null;
  /** e.g. `"debug"`, `"error"`, `"reconnect"`, or `"operation"` (see `operationKind`). */
  systemKind?: string;
  /** e.g. `"context-clear"`, `"compaction"`, `"parent-change"`, `"reasoning"`,
   *  `"warning"` — real values are hyphenated, not underscored. */
  operationKind?: string;
  /** Only present when `operationKind === "parent-change"`; titles are the
   *  human-readable form, preferred over the bare ids. */
  parentChange?: {
    action?: string;
    previousParentThreadId?: string;
    previousParentThreadTitle?: string;
    nextParentThreadId?: string;
    nextParentThreadTitle?: string;
  };
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

/** `"400ms"` under a second, else `"2.3s"` — computed from real Unix-ms
 *  numbers (BBP-206 R2b: `Date.parse` on a number was always `NaN`). */
function duration(startedAt?: number, completedAt?: number): string | undefined {
  if (typeof startedAt !== "number" || typeof completedAt !== "number") return undefined;
  const ms = completedAt - startedAt;
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** The first line of the first conversation row with `role: "user"` among
 *  `rows` — the turn's own request. Untruncated; callers pick their own
 *  length (the card label and the sidebar field truncate differently). */
function firstUserLine(rows: readonly TimelineRowLike[] | null | undefined): string | undefined {
  const request = (rows ?? []).find((row) => row.kind === "conversation" && row.role === "user");
  const line = request?.text?.split("\n").find((candidate) => candidate.trim() !== "");
  return line || undefined;
}

function rowLabel(row: TimelineRowLike): string {
  if (row.kind === "conversation") return truncate(row.text ?? "(empty)", 48) || "(empty)";
  if (isSubagentRow(row)) return `Agent: ${row.description ?? "(no description)"}`;
  if (row.toolName) return row.toolName;
  return row.kind;
}

// The sidebar itself truncates a long value behind a "more" toggle
// (BBP-206 review round 1) — every meta builder below stores the full
// value, never a clipped one, so "more" always has the real thing to reveal.
function commandMeta(row: TimelineRowLike, threadId: string | undefined): Record<string, unknown> {
  return compact({
    command: row.command,
    cwd: row.cwd,
    outputPreview: row.outputPreview || row.output || "",
    exitCode: row.exitCode,
    duration: duration(row.startedAt, row.completedAt),
    startedAt: formatTimestamp(row.startedAt),
    completedAt: formatTimestamp(row.completedAt),
    ...(threadId && typeof row.sourceSeqStart === "number" ? { threadId, sourceSeq: row.sourceSeqStart } : {}),
  });
}

function toolMeta(row: TimelineRowLike, threadId: string | undefined): Record<string, unknown> {
  const argsString = argsText(row.toolArgs);
  const isCommandShaped = typeof row.toolArgs === "string" || typeof (row.toolArgs as { command?: unknown } | null)?.command === "string";
  return compact({
    toolName: row.toolName,
    ...(isCommandShaped ? { command: argsString } : { toolArgs: argsString }),
    outputPreview: row.outputPreview || row.output || "",
    duration: duration(row.startedAt, row.completedAt),
    startedAt: formatTimestamp(row.startedAt),
    completedAt: formatTimestamp(row.completedAt),
    ...(threadId && typeof row.sourceSeqStart === "number" ? { threadId, sourceSeq: row.sourceSeqStart } : {}),
  });
}

function fileChangeMeta(row: TimelineRowLike, threadId: string | undefined): Record<string, unknown> {
  const diffStats = row.change?.diffStats;
  return compact({
    path: row.change?.path,
    changeKind: row.change?.kind,
    diffStats: diffStats ? `+${diffStats.added} -${diffStats.removed}` : undefined,
    stdout: row.stdout || "",
    stderr: row.stderr || "",
    duration: duration(row.startedAt, row.completedAt),
    startedAt: formatTimestamp(row.startedAt),
    completedAt: formatTimestamp(row.completedAt),
    ...(threadId && typeof row.sourceSeqStart === "number" ? { threadId, sourceSeq: row.sourceSeqStart } : {}),
  });
}

/** Dispatches a `"work"` row's sidebar fields by `workKind` — the four real
 *  shapes BBP-206 covers have disjoint fields (a shell command's `exitCode`
 *  does not exist on an MCP tool call, a file edit has neither); reading
 *  them through one flat object produced `[object Object]`/empty fields
 *  before (BBP-206 R2b finding 1). Any other `workKind` (11 not covered)
 *  falls through to an empty object — status/summary from the caller still
 *  show, nothing crashes or reads fields that do not exist on it. */
function workMeta(row: TimelineRowLike, threadId: string | undefined): Record<string, unknown> {
  switch (row.workKind) {
    case "command":
      return commandMeta(row, threadId);
    case "tool":
      return toolMeta(row, threadId);
    case "file-change":
      return fileChangeMeta(row, threadId);
    default:
      return {};
  }
}

/** The card label for a `"work"` row, by `workKind`. Delegation is handled
 *  by `rowLabel`'s subagent branch before this is ever reached. */
function workLabel(row: TimelineRowLike): string {
  switch (row.workKind) {
    case "command":
      return row.command ? truncate(row.command, 48) : row.kind;
    case "tool":
      return row.toolName ?? row.kind;
    case "file-change": {
      const path = row.change?.path;
      return path ? (path.split("/").pop() ?? path) : row.kind;
    }
    default:
      return rowLabel(row);
  }
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
    label: isWork ? workLabel(row) : rowLabel(row),
    ...(failed ? { status: "failed" as const } : {}),
    parentId,
    meta: {
      rowId: row.id,
      kind: row.kind,
      ...(row.status ? { status: row.status } : {}),
      ...(row.output && isSubagentRow(row) ? { summary: row.output } : {}),
      ...(isWork ? workMeta(row, threadId) : {}),
    },
  };
  const children = mapRows(row.childRows ?? [], id, threadId);
  return [node, ...children];
}

/** An error, or an operation that says what happened, stands on its own;
 *  `reasoning` always bundles even though it always has a `detail` (BBP-206
 *  R2b finding 6 — a reasoning-heavy turn produced dozens of single-row
 *  "Thought" nodes before this exclusion). Every other minor system row is
 *  noise worth one bundled node. */
function isOwnSystemEvent(row: TimelineRowLike): boolean {
  if (row.systemKind === "error") return true;
  if (row.systemKind !== "operation") return false;
  if (row.operationKind === "reasoning") return false;
  // A parent-change's own information lives in `parentChange`, not `detail`
  // (which is often null for it) — it always stands on its own regardless.
  if (row.operationKind === "parent-change") return true;
  return !!row.detail;
}

function systemEventNode(row: TimelineRowLike, parentId: string): CanvasNode {
  const parentChange = row.operationKind === "parent-change" ? row.parentChange : undefined;
  return {
    id: `row:${row.id}`,
    kind: "system-event",
    label: row.title || row.operationKind || row.systemKind || "system event",
    ...(row.systemKind === "error" ? { status: "failed" as const } : {}),
    parentId,
    meta: compact({
      rowId: row.id,
      detail: row.detail,
      ...(parentChange
        ? {
            oldParent: parentChange.previousParentThreadTitle ?? parentChange.previousParentThreadId,
            newParent: parentChange.nextParentThreadTitle ?? parentChange.nextParentThreadId,
          }
        : {}),
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
    const firstLine = truncate(firstUserLine(row.children) ?? "", 120);
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

/** What `enrichTurnNodes` needs to fetch one turn's lazily-loaded steps —
 *  the same page `loadChildren` fetches on an expand click, just triggered
 *  eagerly here so the card's first line doesn't wait for that. */
export type TurnFirstLinePort = {
  turnDetails: (
    turnId: string,
    threadId: string,
    sourceSeqStart: number,
    sourceSeqEnd: number,
  ) => Promise<{ rows: readonly TimelineRowLike[] }>;
};

/** Replaces each turn node without a `meta.firstLine` — real thread-level
 *  pages never carry a turn's `children` (BBP-206 R2b finding 3: they are
 *  always `null`, fetched lazily) — with one carrying the first line of its
 *  own request, once that page loads. A turn with 0 steps, missing
 *  coordinates, or whose first page has no `role: "user"` row keeps its
 *  plain `"Turn · n steps"` label; this never throws and never drops a node. */
export async function enrichTurnNodes(nodes: readonly CanvasNode[], port: TurnFirstLinePort): Promise<CanvasNode[]> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pending = nodes.filter((node) => node.kind === "turn" && node.meta?.firstLine === undefined);
  await Promise.all(
    pending.map(async (node) => {
      const { threadId, turnId, sourceSeqStart, sourceSeqEnd, summaryCount } = node.meta ?? {};
      if (
        typeof threadId !== "string" ||
        typeof turnId !== "string" ||
        typeof sourceSeqStart !== "number" ||
        typeof sourceSeqEnd !== "number" ||
        typeof summaryCount !== "number" ||
        summaryCount === 0
      ) {
        return;
      }
      try {
        const { rows } = await port.turnDetails(turnId, threadId, sourceSeqStart, sourceSeqEnd);
        const line = firstUserLine(rows);
        if (!line) return;
        byId.set(node.id, {
          ...node,
          label: `${truncate(line, 48)} · ${summaryCount} ${summaryCount === 1 ? "step" : "steps"}`,
          meta: { ...node.meta, firstLine: truncate(line, 120) },
        });
      } catch {
        // Turn steps unreadable: the plain "Turn · n steps" label stands.
      }
    }),
  );
  return nodes.map((node) => byId.get(node.id) ?? node);
}
