import { describe, expect, it } from "vitest";
import { filterActive } from "../lib/active-filter";
import type { CanvasNode } from "../lib/types";

const node = (id: string, parentId: string | undefined, extra: Partial<CanvasNode> = {}): CanvasNode => ({ id, kind: "thread", label: id, parentId, ...extra });

describe("filterActive (BBP-288)", () => {
  const tree = [
    node("agents", undefined, { kind: "agents" }),
    node("p1", "agents", { kind: "project" }),
    node("p2", "agents", { kind: "project" }),
    node("run", "p1", { status: "running" }),
    node("wait", "p1", { status: "waiting" }),
    node("idle", "p1", { status: "idle" }),
    node("done", "p2", { status: "done" }),
    node("turn-done", "run", { kind: "turn", status: "done" }),
    node("turn-run", "run", { kind: "turn", status: "running" }),
  ];

  it("keeps every running or waiting node and its ancestors, nothing else", () => {
    expect(filterActive(tree).map((n) => n.id)).toEqual(["agents", "p1", "run", "wait", "turn-run"]);
  });

  it("is empty when nothing runs", () => {
    expect(filterActive(tree.filter((n) => n.status !== "running" && n.status !== "waiting"))).toEqual([]);
  });

  it("drops a crew marked running whose members are all idle", () => {
    const crew = [node("p1", undefined, { kind: "project" }), node("crew", "p1", { kind: "crew", status: "running" }), node("m1", "crew", { kind: "member", status: "idle" })];
    expect(filterActive(crew)).toEqual([]);
  });
});
