// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/Sidebar";
import type { CanvasNode } from "@/lib/types";

afterEach(cleanup);

describe("Sidebar", () => {
  it("shows the node's label and kind", () => {
    const node: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.getByText("orch-lead")).toBeTruthy();
    expect(screen.getByText("member")).toBeTruthy();
  });

  it("lists every meta field", () => {
    const node: CanvasNode = {
      id: "m1",
      kind: "member",
      label: "orch-lead",
      parentId: null,
      meta: { role: "lead", crew: "factory-1" },
    };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.getByText("role")).toBeTruthy();
    expect(screen.getByText("lead")).toBeTruthy();
    expect(screen.getByText("crew")).toBeTruthy();
    expect(screen.getByText("factory-1")).toBeTruthy();
  });

  it("calls onClose when its close button is pressed", () => {
    const onClose = vi.fn();
    const node: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null };
    render(<Sidebar node={node} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
