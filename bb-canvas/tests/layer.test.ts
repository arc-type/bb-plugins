import { describe, expect, it } from "vitest";
import { EMPTY_LAYER, mergeLayers, projectNodeId, projectOfCrew, withRoots } from "../lib/layer";

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

describe("projectOfCrew (BBP-179 merge: several projects on one canvas)", () => {
  const nodes = [
    { id: "project:p1", kind: "project" as const, label: "Shop", parentId: "agents" },
    { id: "project:p2", kind: "project" as const, label: "Blog", parentId: "agents" },
    { id: "crew:a", kind: "crew" as const, label: "a", parentId: "project:p2", meta: { crew: "a" } },
  ];

  it("finds the project a crew hangs under", () => {
    expect(projectOfCrew(nodes, "a")).toBe("p2");
  });

  it("negative: an unknown crew has no project", () => {
    expect(projectOfCrew(nodes, "zzz")).toBeNull();
  });
});
