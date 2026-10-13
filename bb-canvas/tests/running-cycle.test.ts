import { describe, expect, it } from "vitest";
import { nextRunningId } from "../lib/running-cycle";
import type { CanvasNode } from "../lib/types";

const node = (id: string, status?: CanvasNode["status"]): CanvasNode => ({ id, kind: "thread", label: id, parentId: null, ...(status ? { status } : {}) });
const nodes = [node("a", "running"), node("b"), node("c", "running"), node("d", "failed")];

describe("nextRunningId (BBP-290)", () => {
  it("starts at the first running node", () => {
    expect(nextRunningId(nodes, null)).toBe("a");
  });

  it("moves on to the next running node and wraps around", () => {
    expect(nextRunningId(nodes, "a")).toBe("c");
    expect(nextRunningId(nodes, "c")).toBe("a");
  });

  it("from a node that is not running, takes the next running one after it", () => {
    expect(nextRunningId(nodes, "b")).toBe("c");
    expect(nextRunningId(nodes, "d")).toBe("a");
  });

  it("is null when nothing runs", () => {
    expect(nextRunningId([node("b"), node("d", "failed")], null)).toBeNull();
  });
});
