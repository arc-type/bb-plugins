import { describe, expect, it } from "vitest";
import { threadNodeFor, threadNodeId, timelineToCanvas } from "../lib/canvas-threads";
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

  it("nests a turn row's children under its own canvas node", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "turn-1",
          kind: "turn",
          turnId: "turn-1",
          status: "completed",
          summaryCount: 2,
          children: [
            { id: "r1", kind: "conversation", text: "Go" },
            { id: "r2", kind: "tool" },
          ],
        },
      ],
    });
    const turn = nodes.find((node) => node.id === "row:turn-1")!;
    expect(turn.status).toBe("done");
    expect(turn.label).toBe("Turn · 2 steps");
    expect(nodes.filter((node) => node.parentId === turn.id).map((node) => node.id)).toEqual(["row:r1", "row:r2"]);
  });
});
