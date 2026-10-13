import { describe, expect, it } from "vitest";
import { activityList } from "../lib/activity";
import type { CanvasNode } from "../lib/types";

const n = (id: string, parentId: string, extra: Partial<CanvasNode> = {}): CanvasNode => ({ id, kind: "turn", label: id, parentId, ...extra });

describe("activityList (BBP-291)", () => {
  const nodes = [n("a", "thread:t1"), n("b", "thread:t1", { kind: "system-event" }), n("a-step", "a", { kind: "tool-call" }), n("c", "thread:t1", { status: "running" })];

  it("lists every row under the thread in order, and how many of them the canvas shows", () => {
    const list = activityList(nodes, "thread:t1", 1);
    expect(list.entries.map((entry) => [entry.id, entry.inCanvas])).toEqual([
      ["a", false],
      ["b", true],
      ["c", true],
    ]);
    expect(list.header).toBe("2 of 3 in canvas");
  });

  it("shows every row when there is no turn limit", () => {
    expect(activityList(nodes, "thread:t1", null).header).toBe("3 of 3 in canvas");
  });

  it("is empty for a thread without rows", () => {
    expect(activityList([], "thread:t1", 10)).toEqual({ entries: [], header: "0 of 0 in canvas" });
  });
});
