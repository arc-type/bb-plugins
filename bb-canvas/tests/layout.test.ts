import { describe, expect, it } from "vitest";
import { layoutTree, MARGIN, NODE_HEIGHT, NODE_WIDTH, COLUMN_GAP, ROW_GAP } from "@/lib/layout";
import type { CanvasEdge, CanvasNode } from "@/lib/types";

function node(id: string, parentId: string | null, overrides: Partial<CanvasNode> = {}): CanvasNode {
  return { id, kind: "member", label: id, parentId, ...overrides };
}

describe("layoutTree", () => {
  it("lays a tree out left to right, one column per depth", () => {
    const nodes = [
      node("agents", null, { kind: "agents" }),
      node("project", "agents", { kind: "project" }),
      node("crew", "project", { kind: "crew" }),
      node("m1", "crew", { kind: "member" }),
    ];
    const expanded = new Set(["agents", "project", "crew"]);
    const { positions } = layoutTree(nodes, expanded);

    const byId = new Map(positions.map((placed) => [placed.id, placed]));
    expect(byId.get("agents")!.column).toBe(0);
    expect(byId.get("project")!.column).toBe(1);
    expect(byId.get("crew")!.column).toBe(2);
    expect(byId.get("m1")!.column).toBe(3);
    // Columns step right by one node width plus the column gap.
    expect(byId.get("project")!.x).toBe(byId.get("agents")!.x + NODE_WIDTH + COLUMN_GAP);
    expect(byId.get("agents")!.x).toBe(MARGIN);
  });

  it("stacks siblings in the same column, one row apart", () => {
    const nodes = [
      node("crew", null, { kind: "crew" }),
      node("m1", "crew"),
      node("m2", "crew"),
      node("m3", "crew"),
    ];
    const { positions } = layoutTree(nodes, new Set(["crew"]));
    const byId = new Map(positions.map((placed) => [placed.id, placed]));
    expect(byId.get("m1")!.column).toBe(byId.get("m2")!.column);
    expect(byId.get("m2")!.column).toBe(byId.get("m3")!.column);
    expect(byId.get("m2")!.y).toBe(byId.get("m1")!.y + NODE_HEIGHT + ROW_GAP);
    expect(byId.get("m3")!.y).toBe(byId.get("m2")!.y + NODE_HEIGHT + ROW_GAP);
  });

  it("centres a parent on its open children and keeps subtrees apart", () => {
    const nodes = [
      node("project", null, { kind: "project" }),
      node("crewA", "project", { kind: "crew" }),
      node("a1", "crewA"),
      node("a2", "crewA"),
      node("a3", "crewA"),
      node("crewB", "project", { kind: "crew" }),
      node("b1", "crewB"),
    ];
    const { positions } = layoutTree(nodes, new Set(["project", "crewA", "crewB"]));
    const byId = new Map(positions.map((placed) => [placed.id, placed]));
    expect(byId.get("crewA")!.y).toBe(byId.get("a2")!.y);
    expect(byId.get("crewB")!.y).toBe(byId.get("b1")!.y);
    expect(byId.get("b1")!.y).toBe(byId.get("a3")!.y + NODE_HEIGHT + ROW_GAP);
    expect(byId.get("project")!.y).toBe((byId.get("crewA")!.y + byId.get("crewB")!.y) / 2);
  });

  it("hides the children of a node that is not expanded", () => {
    const nodes = [node("crew", null, { kind: "crew" }), node("m1", "crew")];
    const { positions } = layoutTree(nodes, new Set());
    expect(positions.map((placed) => placed.id)).toEqual(["crew"]);
  });

  it("idempotent: expanding an already-expanded node does not duplicate it", () => {
    const nodes = [node("crew", null, { kind: "crew" }), node("m1", "crew")];
    const once = layoutTree(nodes, new Set(["crew"]));
    const again = layoutTree(nodes, new Set(["crew"]));
    expect(again.positions).toEqual(once.positions);
  });

  it("roots a node whose declared parent is missing, instead of throwing", () => {
    const nodes = [node("orphan", "ghost")];
    expect(() => layoutTree(nodes, new Set())).not.toThrow();
    const { positions } = layoutTree(nodes, new Set());
    expect(positions).toHaveLength(1);
    expect(positions[0]!.column).toBe(0);
  });

  it("draws a flow edge from every visible node to its parent", () => {
    const nodes = [node("crew", null, { kind: "crew" }), node("m1", "crew")];
    const { edges } = layoutTree(nodes, new Set(["crew"]));
    const flow = edges.find((edge) => edge.from === "crew" && edge.to === "m1");
    expect(flow).toBeDefined();
    expect(flow!.variant).toBe("flow");
    expect(flow!.isBack).toBe(false);
  });

  it("routes a back edge as an arc to the right of its column, with a label", () => {
    const nodes = [
      node("run", null, { kind: "graph-run" }),
      node("a", "run", { kind: "step" }),
      node("b", "run", { kind: "step" }),
      node("c", "run", { kind: "step" }),
    ];
    const backEdges: CanvasEdge[] = [{ from: "c", to: "a", variant: "back", label: "retry" }];
    const { edges } = layoutTree(nodes, new Set(["run"]), backEdges);
    const back = edges.find((edge) => edge.from === "c" && edge.to === "a");
    expect(back).toBeDefined();
    expect(back!.variant).toBe("back");
    expect(back!.isBack).toBe(true);
    expect(back!.label).toBe("retry");
    // Bows out to the right of the node, not straight down through it.
    expect(back!.path).toContain("C");
  });

  it("drops a declared edge whose endpoint is collapsed out of view", () => {
    const nodes = [
      node("run", null, { kind: "graph-run" }),
      node("a", "run", { kind: "step" }),
      node("b", "run", { kind: "step" }),
    ];
    const edges: CanvasEdge[] = [{ from: "b", to: "a", variant: "back" }];
    // "run" itself is not expanded, so neither step is visible.
    const { edges: placed } = layoutTree(nodes, new Set(), edges);
    expect(placed).toHaveLength(0);
  });
});
