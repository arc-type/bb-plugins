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
