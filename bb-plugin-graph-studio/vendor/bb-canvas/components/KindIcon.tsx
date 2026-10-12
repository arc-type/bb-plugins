// One single-colour line icon per node kind, drawn in `currentColor` so the
// card decides the tint. 14px, 1.5 stroke — the same weight as the host's
// sidebar icons.
import type { CanvasNodeKind } from "../lib/types";

const PATHS: Record<CanvasNodeKind, string> = {
  agents: "M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z",
  project: "M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z",
  crew: "M5.5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13c0-2 1.6-3.5 3.5-3.5S9 11 9 13M11 7.5a1.6 1.6 0 1 0 0-3.2M11.5 9.6c1.4.3 2.5 1.6 2.5 3.4",
  member: "M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4",
  "graph-run": "M4 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 9.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM5.5 5h3a2 2 0 0 1 2 2v2.5",
  step: "M3 3.5h10v3H3zM3 9.5h10v3H3z",
  thread: "M3 3.5h10v7H7l-3 2.5v-2.5H3z",
  turn: "M3 8h8M8 5l3 3-3 3",
  "tool-call": "M9.5 3.5a3 3 0 0 0-3.4 4L3 10.6 5.4 13l3.1-3.1a3 3 0 0 0 4-3.4l-1.8 1.8-1.8-.5-.5-1.8z",
  subagent: "M8 2.5 3 5v6l5 2.5 5-2.5V5zM8 2.5v10M3 5l5 2.5M13 5l-5 2.5",
};

export function KindIcon({ kind }: { kind: CanvasNodeKind }) {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[kind]} />
    </svg>
  );
}

export const KIND_LABEL: Record<CanvasNodeKind, string> = {
  agents: "Agents",
  project: "Project",
  crew: "Crew",
  member: "Member",
  "graph-run": "Graph run",
  step: "Step",
  thread: "Thread",
  turn: "Turn",
  "tool-call": "Tool call",
  subagent: "Subagent",
};

const CHILD_NOUN: Partial<Record<CanvasNodeKind, [string, string]>> = {
  agents: ["project", "projects"],
  crew: ["member", "members"],
  "graph-run": ["step", "steps"],
};

/** The card's second line: what the node is, plus the one number or fact
 *  that tells it apart from its siblings ("Crew · 9 members", "Member ·
 *  claude-opus-5-5"). Everything else lives in the sidebar. */
export function describeNode(kind: CanvasNodeKind, childCount: number, meta?: Record<string, unknown>): string {
  const parts = [KIND_LABEL[kind]];
  const noun = CHILD_NOUN[kind];
  if (noun && childCount > 0) parts.push(`${childCount} ${childCount === 1 ? noun[0] : noun[1]}`);
  const model = typeof meta?.model === "string" ? meta.model.split("/").pop() : undefined;
  if (kind === "member" && model) parts.push(model);
  return parts.join(" · ");
}
