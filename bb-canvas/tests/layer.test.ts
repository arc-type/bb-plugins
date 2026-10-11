import { describe, expect, it } from "vitest";
import { EMPTY_LAYER, mergeLayers, projectNodeId, withRoots } from "../lib/layer";

describe("canvas layers", () => {
  it("merges nodes, edges and expanded ids of several providers in order, dropping duplicate ids", () => {
    const a = { nodes: [{ id: "x", kind: "crew" as const, label: "X", parentId: null }], edges: [], expanded: ["x"] };
    const b = {
      nodes: [{ id: "y", kind: "graph-run" as const, label: "Y", parentId: "x" }, { id: "x", kind: "crew" as const, label: "dup", parentId: null }],
      edges: [{ from: "y", to: "x", variant: "back" as const }],
      expanded: ["x", "y"],
    };
    expect(mergeLayers(a, b)).toEqual({
      nodes: [a.nodes[0], b.nodes[0]],
      edges: b.edges,
      expanded: ["x", "y"],
    });
  });

  it("adds the agents and project roots, both expanded", () => {
    const layer = withRoots("p1", "Shop", EMPTY_LAYER);
    expect(layer.nodes).toEqual([
      { id: "agents", kind: "agents", label: "Agents", parentId: null },
      { id: projectNodeId("p1"), kind: "project", label: "Shop", parentId: "agents" },
    ]);
    expect(layer.expanded).toEqual(["agents", "project:p1"]);
  });
});
