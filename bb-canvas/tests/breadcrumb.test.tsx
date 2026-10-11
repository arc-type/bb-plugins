// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Breadcrumb, pathTo } from "@/components/Breadcrumb";
import type { CanvasNode } from "@/lib/types";

afterEach(cleanup);

const nodes: CanvasNode[] = [
  { id: "agents", kind: "agents", label: "Agents", parentId: null },
  { id: "project", kind: "project", label: "bb-plugins", parentId: "agents" },
  { id: "crew", kind: "crew", label: "factory-1", parentId: "project" },
];

describe("pathTo", () => {
  it("walks from the root down to the node, root first", () => {
    expect(pathTo(nodes, "crew").map((node) => node.id)).toEqual(["agents", "project", "crew"]);
  });

  it("stops at a parent missing from the set instead of throwing", () => {
    const orphan: CanvasNode = { id: "x", kind: "member", label: "X", parentId: "ghost" };
    expect(() => pathTo([...nodes, orphan], "x")).not.toThrow();
    expect(pathTo([...nodes, orphan], "x").map((node) => node.id)).toEqual(["x"]);
  });
});

describe("Breadcrumb", () => {
  it("shows nothing when no node is selected", () => {
    const { container } = render(<Breadcrumb nodes={nodes} selectedId={null} onSelect={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the full path to the selected node", () => {
    render(<Breadcrumb nodes={nodes} selectedId="crew" onSelect={vi.fn()} />);
    expect(screen.getByText("Agents")).toBeTruthy();
    expect(screen.getByText("bb-plugins")).toBeTruthy();
    expect(screen.getByText("factory-1")).toBeTruthy();
  });

  it("selects the clicked crumb", () => {
    const onSelect = vi.fn();
    render(<Breadcrumb nodes={nodes} selectedId="crew" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("bb-plugins"));
    expect(onSelect).toHaveBeenCalledWith("project");
  });
});
