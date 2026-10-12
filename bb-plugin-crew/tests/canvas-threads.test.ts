import { describe, expect, it } from "vitest";
import { threadNodeFor, threadNodeId, timelineToCanvas, turnDetailsToCanvas } from "../lib/canvas-threads";
import type { CanvasNode } from "../vendor/bb-canvas/lib/types";

describe("threadNodeFor", () => {
  it("builds a collapsed thread node under a member with a bound thread", () => {
    const member: CanvasNode = {
      id: "member:a@crew",
      kind: "member",
      label: "a",
      parentId: "crew:crew",
      meta: { threadId: "t1" },
    };
    expect(threadNodeFor(member)).toEqual({
      id: "thread:t1",
      kind: "thread",
      label: "Thread",
      parentId: "member:a@crew",
      meta: { threadId: "t1" },
    });
  });

  it("returns null for a node without a bound thread", () => {
    const member: CanvasNode = { id: "member:a@crew", kind: "member", label: "a", parentId: "crew:crew" };
    expect(threadNodeFor(member)).toBeNull();
  });
});

describe("timelineToCanvas", () => {
  it("turns a conversation row into a turn node", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "r1", kind: "conversation", text: "Please fix the bug" }] });
    expect(nodes).toEqual([
      { id: "row:r1", kind: "turn", label: "Please fix the bug", parentId: threadNodeId("t1"), meta: { rowId: "r1", kind: "conversation" } },
    ]);
  });

  it("turns a work row into a tool-call node, labelled by its kind", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "r2", kind: "tool" }] });
    expect(nodes[0]).toMatchObject({ id: "row:r2", kind: "tool-call", label: "tool" });
  });

  it("labels a tool-call row by its tool name, not its raw kind", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "r3", kind: "work", workKind: "tool", toolName: "Bash", status: "completed" }],
    });
    expect(nodes[0]).toMatchObject({ id: "row:r3", kind: "tool-call", label: "Bash" });
  });

  it("falls back to the raw kind when a work row has no tool name", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "r4", kind: "mystery-row" }] });
    expect(nodes[0]).toMatchObject({ id: "row:r4", kind: "tool-call", label: "mystery-row" });
  });

  it("maps a delegation row to the subagent kind, labelled by its description", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "r5",
          kind: "work",
          workKind: "delegation",
          toolName: "Task",
          status: "pending",
          description: "fix the flaky test",
        },
      ],
    });
    expect(nodes[0]).toMatchObject({ id: "row:r5", kind: "subagent", label: "Agent: fix the flaky test" });
  });

  it("nests a delegation row's own childRows underneath its canvas node", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "r6",
          kind: "work",
          workKind: "delegation",
          toolName: "Task",
          status: "completed",
          description: "research the bug",
          childRows: [{ id: "r7", kind: "work", workKind: "tool", toolName: "Read", status: "completed" }],
        },
      ],
    });
    const subagent = nodes.find((node) => node.id === "row:r6")!;
    expect(subagent.kind).toBe("subagent");
    expect(nodes.filter((node) => node.parentId === subagent.id).map((node) => node.id)).toEqual(["row:r7"]);
  });

  it("puts status and a short output summary into a tool-call's meta", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        { id: "r8", kind: "work", workKind: "delegation", toolName: "Task", status: "completed", description: "list files", output: "ls -la → 3 files" },
      ],
    });
    expect(nodes[0].meta).toMatchObject({ status: "completed", summary: "ls -la → 3 files" });
  });

  it("falls back to a generic tool-call for a delegation row with no description", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "r9", kind: "work", workKind: "delegation", toolName: "Task", status: "pending", description: null }],
    });
    expect(nodes[0]).toMatchObject({ kind: "subagent", label: "Agent: (no description)" });
  });

  it("builds an expandable turn node from the real timeline shape (children: null)", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "turn-1",
          kind: "turn",
          turnId: "turn-1",
          status: "completed",
          summaryCount: 2,
          sourceSeqStart: 10,
          sourceSeqEnd: 20,
          children: null,
        },
      ],
    });
    const turn = nodes.find((node) => node.id === "row:turn-1")!;
    expect(turn.status).toBe("done");
    expect(turn.label).toBe("Turn · 2 steps");
    expect(turn.meta).toMatchObject({
      threadId: "t1",
      turnId: "turn-1",
      sourceSeqStart: 10,
      sourceSeqEnd: 20,
      summaryCount: 2,
    });
  });

  it("carries summaryCount: 0 in meta for a turn with no steps, so it gets no chevron", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "turn-2", kind: "turn", turnId: "turn-2", status: "completed", summaryCount: 0, children: null }],
    });
    expect(nodes[0]!.meta).toMatchObject({ summaryCount: 0 });
  });

  it("nests a turn row's eagerly-provided children under its own canvas node (defensive, not the real SDK shape)", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "turn-3",
          kind: "turn",
          turnId: "turn-3",
          status: "completed",
          summaryCount: 2,
          children: [
            { id: "r1", kind: "conversation", text: "Go" },
            { id: "r2", kind: "tool" },
          ],
        },
      ],
    });
    const turn = nodes.find((node) => node.id === "row:turn-3")!;
    expect(nodes.filter((node) => node.parentId === turn.id).map((node) => node.id)).toEqual(["row:r1", "row:r2"]);
  });
});

describe("timelineToCanvas: system rows", () => {
  it("maps a systemKind error row to its own system-event node, not bundled, status failed", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "s1", kind: "system", systemKind: "error", title: "Thread interrupted", detail: "host daemon disconnected" }],
    });
    expect(nodes).toEqual([
      {
        id: "row:s1",
        kind: "system-event",
        label: "Thread interrupted",
        status: "failed",
        parentId: threadNodeId("t1"),
        meta: { detail: "host daemon disconnected" },
      },
    ]);
  });

  it("maps a parent-change operation row with old and new parent in its meta", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "s2",
          kind: "system",
          systemKind: "operation",
          operationKind: "parent-change",
          title: "Thread moved",
          oldParentId: "thr_a",
          newParentId: "thr_b",
        },
      ],
    });
    expect(nodes[0]).toMatchObject({
      id: "row:s2",
      kind: "system-event",
      label: "Thread moved",
      meta: { oldParent: "thr_a", newParent: "thr_b" },
    });
    expect(nodes[0].status).toBeUndefined();
  });

  it("bundles two consecutive debug/reconnect rows without detail into one '2 system events' node", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        { id: "s3", kind: "system", systemKind: "debug", title: "debug one" },
        { id: "s4", kind: "system", systemKind: "reconnect", title: "reconnect" },
      ],
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "system-event", label: "2 system events" });
    expect(nodes[0].meta?.titles).toBe("debug one, reconnect");
  });

  it("bundles a single system row without title/detail into a valid '1 system event' node, never empty or tool-call", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "s5", kind: "system" }] });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].kind).toBe("system-event");
    expect(nodes[0].label).toBe("1 system event");
    expect(nodes[0].meta?.titles).toBeUndefined();
  });

  it("keeps an error row un-bundled even between two bundleable rows", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        { id: "s6", kind: "system", systemKind: "debug" },
        { id: "s7", kind: "system", systemKind: "error", title: "Rate limited" },
        { id: "s8", kind: "system", systemKind: "debug" },
      ],
    });
    expect(nodes.map((n) => n.label)).toEqual(["1 system event", "Rate limited", "1 system event"]);
  });
});

describe("timelineToCanvas: work rows", () => {
  it("curates a successful tool call's command, output, duration and timestamps", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "w1",
          kind: "work",
          workKind: "tool",
          toolName: "Bash",
          command: "ls -la",
          output: "3 files",
          startedAt: "2026-10-12T08:00:00.000Z",
          completedAt: "2026-10-12T08:00:02.300Z",
          sourceSeqStart: 42,
        },
      ],
    });
    expect(nodes[0]).toMatchObject({
      id: "row:w1",
      kind: "tool-call",
      label: "Bash",
      meta: {
        toolName: "Bash",
        command: "ls -la",
        outputPreview: "3 files",
        duration: "2.3s",
        startedAt: "2026-10-12T08:00:00.000Z",
        completedAt: "2026-10-12T08:00:02.300Z",
        threadId: "t1",
        sourceSeq: 42,
      },
    });
    expect(nodes[0].status).toBeUndefined();
  });

  it("highlights a failed tool call by its non-zero exit code", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w2", kind: "work", workKind: "tool", toolName: "Bash", exitCode: 1 }],
    });
    expect(nodes[0].status).toBe("failed");
    expect(nodes[0].meta).toMatchObject({ exitCode: 1 });
  });

  it("derives a label and command from toolArgs.file_path when toolName/command are absent", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w3", kind: "work", workKind: "tool", toolArgs: { file_path: "/tmp/foo.ts" } }],
    });
    expect(nodes[0]).toMatchObject({ label: "/tmp/foo.ts", meta: { command: "/tmp/foo.ts" } });
  });

  it("shows only the fields a work row actually has — no empty command/duration, no empty Details", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w4", kind: "work", workKind: "tool", toolName: "Read" }],
    });
    expect(nodes[0].meta).toEqual({ rowId: "w4", kind: "work", toolName: "Read", threadId: "t1" });
  });
});

describe("timelineToCanvas: turn firstLine", () => {
  it("carries the first user message's first line in a turn's meta", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "turn-4",
          kind: "turn",
          turnId: "turn-4",
          status: "completed",
          summaryCount: 1,
          children: [{ id: "c1", kind: "conversation", role: "user", text: "Add dark mode\nmore detail" }],
        },
      ],
    });
    expect(nodes[0].meta).toMatchObject({ firstLine: "Add dark mode" });
  });
});

describe("threadNodeFor with title/state/provider", () => {
  it("uses the given title over the generic 'Thread' label, and carries state/provider", () => {
    const member: CanvasNode = { id: "member:a@crew", kind: "member", label: "a", parentId: "crew:crew", meta: { threadId: "t1" } };
    const node = threadNodeFor(member, { title: "Fix login bug", state: "idle", provider: "claude-code" });
    expect(node).toMatchObject({ label: "Fix login bug", meta: { threadId: "t1", state: "idle", provider: "claude-code" } });
  });

  it("falls back to the truncated first user message when no title is given", () => {
    const member: CanvasNode = { id: "member:a@crew", kind: "member", label: "a", parentId: "crew:crew", meta: { threadId: "t1" } };
    const node = threadNodeFor(member, { firstUserMessage: "a very long first message that should get truncated for the card label" });
    expect(node?.label).toBe("a very long first message that should get trunc…");
  });

  it("falls back to 'Thread' when neither title nor first user message is given", () => {
    const member: CanvasNode = { id: "member:a@crew", kind: "member", label: "a", parentId: "crew:crew", meta: { threadId: "t1" } };
    expect(threadNodeFor(member)?.label).toBe("Thread");
  });
});

describe("turnDetailsToCanvas", () => {
  it("maps a turn's lazily-fetched steps under the turn node, same mapping as thread-level rows", () => {
    const { nodes } = turnDetailsToCanvas("row:turn-1", {
      rows: [
        { id: "r1", kind: "work", workKind: "tool", toolName: "Bash", status: "completed" },
        {
          id: "r2",
          kind: "work",
          workKind: "delegation",
          toolName: "Task",
          status: "completed",
          description: "research the bug",
          childRows: [{ id: "r3", kind: "work", workKind: "tool", toolName: "Read", status: "completed" }],
        },
      ],
    });
    expect(nodes.map((node) => node.id)).toEqual(["row:r1", "row:r2", "row:r3"]);
    expect(nodes.filter((node) => node.parentId === "row:turn-1").map((node) => node.id)).toEqual(["row:r1", "row:r2"]);
    expect(nodes.find((node) => node.id === "row:r3")!.parentId).toBe("row:r2");
  });
});
