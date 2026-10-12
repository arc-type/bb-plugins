// @vitest-environment jsdom
// BBP-203: a selected node's own relations in the sidebar, grouped by kind
// ("Assigns to", "Escalates to"), each target a button that selects it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Sidebar } from "@/components/Sidebar";
import { outgoingRelations } from "@/lib/relations";
import type { CanvasEdge, CanvasNode } from "@/lib/types";

afterEach(cleanup);

const nodes: CanvasNode[] = [
  { id: "a", kind: "member", label: "lead", parentId: null },
  { id: "b", kind: "member", label: "dev", parentId: null },
  { id: "c", kind: "member", label: "review", parentId: null },
];
const byId = new Map(nodes.map((node) => [node.id, node]));
// Bundled the way crewTopologyFrame does it (BBP-201): one edge per pair,
// the single links kept in `links`.
const edges: CanvasEdge[] = [
  {
    from: "a", to: "b", variant: "flow", label: "assigns_to ⇄ escalates_to", relation: true,
    links: [{ from: "a", to: "b", kind: "assigns_to" }, { from: "b", to: "a", kind: "escalates_to" }],
  },
  { from: "a", to: "c", variant: "flow", label: "assigns_to", relation: true, links: [{ from: "a", to: "c", kind: "assigns_to" }] },
  { from: "c", to: "b", variant: "message", label: "2" },
];

describe("outgoingRelations", () => {
  it("groups a node's own links by kind, in first-seen order, with readable kind names", () => {
    expect(outgoingRelations(edges, "a", byId)).toEqual([{ kind: "Assigns to", targets: [{ id: "b", label: "dev" }, { id: "c", label: "review" }] }]);
    expect(outgoingRelations(edges, "b", byId)).toEqual([{ kind: "Escalates to", targets: [{ id: "a", label: "lead" }] }]);
  });

  it("negative: incoming links and non-relation edges are not listed", () => {
    expect(outgoingRelations(edges, "c", byId)).toEqual([]);
  });
});

describe("Sidebar relations", () => {
  it("lists each kind with its targets; a click selects the target", () => {
    const onSelect = vi.fn();
    render(<Sidebar node={nodes[0]} onClose={vi.fn()} relations={outgoingRelations(edges, "a", byId)} onSelect={onSelect} />);
    const list = screen.getByRole("region", { name: "Relations" });
    expect(within(list).getByText("Assigns to")).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: "review" }));
    expect(onSelect).toHaveBeenCalledWith("c");
  });

  it("negative: no section without relations", () => {
    render(<Sidebar node={nodes[2]} onClose={vi.fn()} relations={[]} onSelect={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Relations" })).toBeNull();
  });
});
