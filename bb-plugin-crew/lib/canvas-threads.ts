// The canvas page's last level (BBP-131 WI4): a member's bound thread, and —
// lazily, once that thread node is opened — its turns and tool calls from the
// SDK timeline. Pure mapping, so it is testable without the SDK. Identical to
// graph-studio's copy of the same name: each plugin draws its own page from
// the same vendored `bb-canvas`, and this bit of mapping is domain code, not
// part of the shared package.
import type { CanvasEdge, CanvasNode } from "../vendor/bb-canvas/lib/types";
import type { ThreadLike } from "./canvas-details";

export const threadNodeId = (threadId: string): string => `thread:${threadId}`;

/** One thread node per member with a bound thread. Collapsed by default.
 *  Returns `null` for a node without a `meta.threadId`. `extra` lets a
 *  caller that already has the thread's title/state/provider (or its first
 *  user message, for the title fallback) pass them along — this mapping has
 *  no SDK access of its own. */
export function threadNodeFor(
  parent: CanvasNode,
  extra?: { title?: string; state?: string; provider?: string; firstUserMessage?: string },
): CanvasNode | null {
  const threadId = parent.meta?.threadId;
  if (typeof threadId !== "string" || threadId === "") return null;
  const label = extra?.title || (extra?.firstUserMessage ? truncate(extra.firstUserMessage, 48) : "") || "Thread";
  return {
    id: threadNodeId(threadId),
    kind: "thread",
    label,
    parentId: parent.id,
    meta: compactMeta({ threadId, state: extra?.state, provider: extra?.provider }),
  };
}

/** What `enrichThreadNodes` needs to turn a placeholder thread node into
 *  its real card: the thread itself, and — only when it has no title — its
 *  first user message, for the same fallback `threadNodeFor` applies. */
export type ThreadTitlePort = {
  get: (threadId: string) => Promise<ThreadLike>;
  firstUserMessage: (threadId: string) => Promise<string | undefined>;
};

/** Replaces each placeholder `"Thread"` node (built eagerly by `threadNodeFor`
 *  with no `extra`) with one carrying the thread's real title/state/provider,
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
   *  both ends to fetch its own steps via `timelineTurnSummaryDetails`, a
   *  work row needs the start to link back to its exact spot (BBP-206). */
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
  /** A tool row's command/invocation, when the SDK gives one directly. */
  command?: string;
  /** A tool row's raw arguments — read for a file path when `command` is absent. */
  toolArgs?: unknown;
  /** A short excerpt of a tool row's output, preferred over `output`. */
  outputPreview?: string;
  /** A tool row's process exit code; anything but `0` marks the row failed. */
  exitCode?: number;
  startedAt?: string;
  completedAt?: string;
  /** A delegation (subagent) row's task description. */
  description?: string | null;
  /** A delegation row's own nested rows (`TimelineDelegationWorkRow.childRows`). */
  childRows?: readonly TimelineRowLike[] | null;
  /** A delegation row's final output, shown as a short summary. */
  output?: string;
  /** A `"system"` row's own fields (`TimelineSystemRow`). */
  title?: string;
  detail?: string;
  systemKind?: string;
  operationKind?: string;
  oldParentId?: string;
  newParentId?: string;
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

/** Drops `undefined`/`null`/`""` values rather than leaving them for
 *  `curateMeta` to filter — a `""` would otherwise survive into the
 *  sidebar's collapsed Details block as an empty-looking row. */
function compactMeta(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    result[key] = value;
  }
  return result;
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

/** A tool row's command, when the SDK gives one directly or it can be read
 *  off a common argument shape (`file_path`/`path`/`command`). */
function deriveCommand(row: TimelineRowLike): string | undefined {
  if (typeof row.command === "string" && row.command !== "") return row.command;
  const args = row.toolArgs;
  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    for (const key of ["file_path", "path", "command"]) {
      const value = record[key];
      if (typeof value === "string" && value !== "") return value;
    }
  }
  return undefined;
}

/** `"2.3s"`-style duration from two ISO timestamps; absent if either is
 *  missing or unparseable. */
function computeDuration(startedAt?: string, completedAt?: string): string | undefined {
  if (!startedAt || !completedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
  return `${((end - start) / 1000).toFixed(1)}s`;
}

/** The first line of the first `conversation` child with `role: "user"` —
 *  the turn's own request, shown in its sidebar alongside its step count. */
function firstUserLine(children: readonly TimelineRowLike[] | null | undefined): string | undefined {
  const first = (children ?? []).find((child) => child.kind === "conversation" && child.role === "user");
  const line = first?.text?.split("\n")[0]?.trim();
  return line || undefined;
}

/** Builds a tool-call node for a non-delegation `"work"` row: labelled by
 *  tool name or derived command, with the fields its sidebar curates
 *  (BBP-206) — never the former bare `status`/`summary`. */
function mapWorkRow(row: TimelineRowLike, parentId: string, threadId: string): CanvasNode {
  const command = deriveCommand(row);
  const label = truncate(row.toolName || command || row.kind, 48);
  const exitCode = row.exitCode;
  const status: CanvasNode["status"] | undefined = exitCode === undefined ? undefined : exitCode === 0 ? "done" : "failed";
  return {
    id: `row:${row.id}`,
    kind: "tool-call",
    label,
    ...(status ? { status } : {}),
    parentId,
    meta: compactMeta({
      rowId: row.id,
      kind: row.kind,
      toolName: row.toolName,
      command,
      outputPreview: row.outputPreview ?? row.output,
      exitCode,
      duration: computeDuration(row.startedAt, row.completedAt),
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      threadId,
      sourceSeq: row.sourceSeqStart,
    }),
  };
}

/** A `system` row that always gets its own node, never bundled: an error
 *  (status failed, detail visible) or an operation (context_clear,
 *  compaction, warning, deprecation, parent-change). */
function isSystemOwnNode(row: TimelineRowLike): boolean {
  return row.systemKind === "error" || row.systemKind === "operation";
}

function mapSystemOwnNode(row: TimelineRowLike, parentId: string): CanvasNode {
  const status: CanvasNode["status"] | undefined = row.systemKind === "error" ? "failed" : undefined;
  return {
    id: `row:${row.id}`,
    kind: "system-event",
    label: row.title || "(system event)",
    ...(status ? { status } : {}),
    parentId,
    meta: compactMeta({
      detail: row.detail,
      oldParent: row.operationKind === "parent-change" ? row.oldParentId : undefined,
      newParent: row.operationKind === "parent-change" ? row.newParentId : undefined,
    }),
  };
}

/** Every other `system` row (`debug`, `reconnect`, or any row without a
 *  `detail`) is low-signal on its own — a consecutive run of them bundles
 *  into one `"n system events"` node rather than either n empty-looking
 *  nodes or n mislabelled `tool-call`s. */
function mapSystemBundle(rows: readonly TimelineRowLike[], parentId: string): CanvasNode {
  const titles = rows.map((row) => row.title).filter((title): title is string => typeof title === "string" && title !== "");
  return {
    id: `row:${rows[0].id}`,
    kind: "system-event",
    label: `${rows.length} system event${rows.length === 1 ? "" : "s"}`,
    parentId,
    meta: compactMeta({ titles: titles.length > 0 ? titles.join(", ") : undefined }),
  };
}

/** Builds one row's own canvas node plus, for a subagent spawn, its own
 *  `childRows` nested underneath it. Dispatches `conversation` (as a `turn`
 *  node — the fallback shape for a bare conversation row, distinct from a
 *  real `"turn"` row handled in `mapRows`), `work`/delegation (`subagent`),
 *  `work`/tool (`mapWorkRow`), and anything else into the pre-BBP-206
 *  generic `tool-call` fallback so an unrecognised SDK row never crashes. */
function mapRow(row: TimelineRowLike, parentId: string, threadId: string): CanvasNode[] {
  const id = `row:${row.id}`;
  if (row.kind === "conversation") {
    return [{ id, kind: "turn", label: rowLabel(row), parentId, meta: { rowId: row.id, kind: row.kind } }];
  }
  if (isSubagentRow(row)) {
    const node: CanvasNode = {
      id,
      kind: "subagent",
      label: rowLabel(row),
      parentId,
      meta: compactMeta({ rowId: row.id, kind: row.kind, status: row.status, summary: row.output }),
    };
    return [node, ...mapRows(row.childRows ?? [], id, threadId)];
  }
  if (row.kind === "work") return [mapWorkRow(row, parentId, threadId)];
  return [{ id, kind: "tool-call", label: rowLabel(row), parentId, meta: compactMeta({ rowId: row.id, kind: row.kind, status: row.status, summary: row.output }) }];
}

function mapTurnRow(row: TimelineRowLike, parentId: string, threadId: string): CanvasNode[] {
  const turnNodeId = `row:${row.id}`;
  const summaryCount = row.summaryCount ?? (row.children?.length ?? 0);
  const node: CanvasNode = {
    id: turnNodeId,
    kind: "turn",
    label: `Turn · ${summaryCount} ${summaryCount === 1 ? "step" : "steps"}`,
    ...(row.status && TURN_STATUS[row.status] ? { status: TURN_STATUS[row.status] } : {}),
    parentId,
    meta: compactMeta({
      rowId: row.id,
      threadId,
      turnId: row.turnId ?? row.id,
      sourceSeqStart: row.sourceSeqStart,
      sourceSeqEnd: row.sourceSeqEnd,
      summaryCount,
      firstLine: firstUserLine(row.children),
    }),
  };
  const children = row.children ? mapRows(row.children, turnNodeId, threadId) : [];
  return [node, ...children];
}

/** Maps one list of sibling rows, bundling consecutive low-signal `system`
 *  rows as it goes (BBP-206) — the only mapping step that needs more than
 *  one row of lookahead, so it lives above the per-row dispatch. */
function mapRows(rows: readonly TimelineRowLike[], parentId: string, threadId: string): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  let bundle: TimelineRowLike[] = [];
  const flushBundle = () => {
    if (bundle.length === 0) return;
    nodes.push(mapSystemBundle(bundle, parentId));
    bundle = [];
  };
  for (const row of rows) {
    if (row.kind === "system" && !isSystemOwnNode(row)) {
      bundle.push(row);
      continue;
    }
    flushBundle();
    if (row.kind === "turn") nodes.push(...mapTurnRow(row, parentId, threadId));
    else if (row.kind === "system") nodes.push(mapSystemOwnNode(row, parentId));
    else nodes.push(...mapRow(row, parentId, threadId));
  }
  flushBundle();
  return nodes;
}

/** Converts one page of a thread's timeline into canvas nodes under
 *  `threadNodeId(threadId)`, nesting a `"turn"` row's own children. */
export function timelineToCanvas(
  threadId: string,
  response: { rows: readonly TimelineRowLike[] },
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return { nodes: mapRows(response.rows, threadNodeId(threadId), threadId), edges: [] };
}

/** Converts a turn's lazily-fetched steps (`timelineTurnSummaryDetails`'s
 *  `rows`) into canvas nodes under the turn's own node id. Same row mapping
 *  as `timelineToCanvas`'s thread-level rows — only the parent differs. */
export function turnDetailsToCanvas(
  turnNodeId: string,
  response: { rows: readonly TimelineRowLike[] },
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return { nodes: mapRows(response.rows, turnNodeId, ""), edges: [] };
}
