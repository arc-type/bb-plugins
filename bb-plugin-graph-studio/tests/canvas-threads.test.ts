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
    const thread = threadNodeFor(member);
    expect(thread).toEqual({
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
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "r1", kind: "conversation", text: "Please fix the bug" }],
    });
    expect(nodes).toEqual([
      {
        id: "row:r1",
        kind: "turn",
        label: "Please fix the bug",
        parentId: threadNodeId("t1"),
        meta: { rowId: "r1", kind: "conversation" },
      },
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
    const children = nodes.filter((node) => node.parentId === turn.id);
    expect(children.map((node) => node.id)).toEqual(["row:r1", "row:r2"]);
  });

  it("truncates a long conversation text", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "r1", kind: "conversation", text: "x".repeat(100) }],
    });
    expect(nodes[0]!.label.length).toBeLessThanOrEqual(48);
    expect(nodes[0]!.label.endsWith("…")).toBe(true);
  });

  it("falls back to '(empty)' for a conversation row with no text", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "r1", kind: "conversation", text: "" }] });
    expect(nodes[0]!.label).toBe("(empty)");
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

describe("threadNodeFor labels (BBP-209)", () => {
  const member: CanvasNode = { id: "m", kind: "member", label: "a", meta: { threadId: "t1" } };

  it("labels the thread by its title and carries state and provider", () => {
    const thread = threadNodeFor(member, { title: "Fix login bug", state: "idle", provider: "claude-code" })!;
    expect(thread.label).toBe("Fix login bug");
    expect(thread.meta).toEqual({ threadId: "t1", title: "Fix login bug", state: "idle", provider: "claude-code" });
  });

  it("falls back to the truncated first user message", () => {
    const thread = threadNodeFor(member, { firstUserMessage: "y".repeat(100) })!;
    expect(thread.label.length).toBeLessThanOrEqual(48);
    expect(thread.label.endsWith("…")).toBe(true);
  });

  it("falls back to 'Thread' without title or message, never empty", () => {
    expect(threadNodeFor(member, { title: "", firstUserMessage: "  " })!.label).toBe("Thread");
  });
});

describe("work row mapping (BBP-209)", () => {
  it("curates tool name, command, output, duration, times and a thread link", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "w1",
          kind: "work",
          workKind: "tool",
          toolName: "Bash",
          status: "completed",
          toolArgs: { command: "npm test" },
          output: "all green",
          exitCode: 0,
          startedAt: "2026-10-12T10:00:00.000Z",
          completedAt: "2026-10-12T10:00:02.300Z",
          sourceSeqStart: 42,
        },
      ],
    });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "Bash" });
    expect(nodes[0]!.meta).toMatchObject({
      toolName: "Bash",
      command: "npm test",
      outputPreview: "all green",
      exitCode: 0,
      duration: "2.3s",
      startedAt: "2026-10-12T10:00:00.000Z",
      completedAt: "2026-10-12T10:00:02.300Z",
      threadId: "t1",
      sourceSeq: 42,
    });
    expect(nodes[0]!.status).not.toBe("failed");
  });

  it("labels by command or file name when there is no tool name", () => {
    const a = timelineToCanvas("t1", { rows: [{ id: "a", kind: "work", workKind: "tool", toolArgs: { command: "ls -la" } }] });
    expect(a.nodes[0]!.label).toBe("ls -la");
    const b = timelineToCanvas("t1", { rows: [{ id: "b", kind: "work", workKind: "tool", toolArgs: { file_path: "/x/y/z.ts" } }] });
    expect(b.nodes[0]!.label).toBe("z.ts");
  });

  it("marks a non-zero exit code as failed", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w2", kind: "work", workKind: "tool", toolName: "Bash", status: "completed", exitCode: 1 }],
    });
    expect(nodes[0]!.status).toBe("failed");
    expect(nodes[0]!.meta).toMatchObject({ exitCode: 1 });
  });

  it("writes no empty fields for a bare work row", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w3", kind: "work", workKind: "tool", toolName: "Read", toolArgs: "", output: "" }],
    });
    const meta = nodes[0]!.meta!;
    for (const value of Object.values(meta)) expect(value === "" || value === undefined || value === null).toBe(false);
    for (const key of ["command", "toolArgs", "outputPreview", "duration", "startedAt", "sourceSeq"]) expect(meta).not.toHaveProperty(key);
  });
});

describe("system row mapping (BBP-209)", () => {
  it("gives an error its own failed system-event node", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "s1", kind: "system", systemKind: "error", title: "Provider crashed", detail: "stack…" }],
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "system-event", label: "Provider crashed", status: "failed", meta: { detail: "stack…" } });
  });

  it("shows old and new parent for a parent-change operation", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        { id: "s2", kind: "system", systemKind: "operation", operationKind: "parent-change", title: "Moved", detail: "re-parented", oldParentId: "p1", newParentId: "p2" },
      ],
    });
    expect(nodes[0]).toMatchObject({ kind: "system-event", label: "Moved", meta: { detail: "re-parented", oldParent: "p1", newParent: "p2" } });
  });

  it("bundles consecutive debug/reconnect rows into one node", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        { id: "s3", kind: "system", systemKind: "debug", title: "event 1" },
        { id: "s4", kind: "system", systemKind: "reconnect", title: "event 2" },
        { id: "w", kind: "work", workKind: "tool", toolName: "Bash" },
        { id: "s5", kind: "system", systemKind: "debug", title: "event 3" },
      ],
    });
    expect(nodes.map((node) => node.label)).toEqual(["2 system events", "Bash", "1 system event"]);
    expect(nodes[0]).toMatchObject({ kind: "system-event", meta: { titles: ["event 1", "event 2"] } });
  });

  it("bundles a system row without title or detail into a valid node, never a tool-call", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "s6", kind: "system" }] });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "system-event", label: "1 system event" });
    expect(nodes[0]!.meta).not.toHaveProperty("titles");
  });

  it("bundles system rows inside a turn's details too", () => {
    const { nodes } = turnDetailsToCanvas("row:turn", {
      rows: [
        { id: "a", kind: "system", systemKind: "debug", title: "x" },
        { id: "b", kind: "system", systemKind: "debug", title: "y" },
      ],
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "2 system events", parentId: "row:turn" });
  });
});

describe("turn firstLine (BBP-209)", () => {
  it("puts the first line of the user's request into the turn's meta", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "turn",
          kind: "turn",
          children: [
            { id: "c0", kind: "conversation", role: "assistant", text: "hi" },
            { id: "c1", kind: "conversation", role: "user", text: "Add dark mode\nplease" },
          ],
        },
      ],
    });
    expect(nodes[0]).toMatchObject({ label: "Turn · 2 steps", meta: { firstLine: "Add dark mode" } });
  });

  it("omits firstLine without a user message", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "turn", kind: "turn", children: null }] });
    expect(nodes[0]!.meta).not.toHaveProperty("firstLine");
  });
});
