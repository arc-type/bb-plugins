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

describe("Sidebar resize handle", () => {
  const node: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null };
  const width = () => Number(screen.getByRole("separator").getAttribute("aria-valuenow"));
  const aside = () => screen.getByRole("complementary") as HTMLElement;

  afterEach(() => localStorage.clear());

  it("is a vertical separator with the default width and its bounds", () => {
    render(<Sidebar node={node} onClose={vi.fn()} />);
    const handle = screen.getByRole("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuemin")).toBe("240");
    expect(handle.getAttribute("aria-valuemax")).toBe("640");
    expect(width()).toBe(320);
    expect(aside().style.width).toBe("320px");
  });

  it("moves 16px per arrow key; left widens because the handle sits on the left edge", () => {
    render(<Sidebar node={node} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(width()).toBe(336);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    expect(width()).toBe(304);
    expect(aside().style.width).toBe("304px");
  });

  it("jumps to the bounds with Home/End and never goes past them", () => {
    render(<Sidebar node={node} onClose={vi.fn()} />);
    const handle = screen.getByRole("separator");
    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(width()).toBe(640);
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(width()).toBe(240);
  });

  it("ignores unrelated keys", () => {
    render(<Sidebar node={node} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowUp" });
    expect(width()).toBe(320);
  });

  it("resizes by mouse drag and clamps a drag past either edge", () => {
    render(<Sidebar node={node} onClose={vi.fn()} />);
    const handle = screen.getByRole("separator");
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 450 });
    expect(width()).toBe(370);
    fireEvent.mouseMove(window, { clientX: -2000 });
    expect(width()).toBe(640);
    fireEvent.mouseMove(window, { clientX: 2000 });
    expect(width()).toBe(240);
    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientX: 450 });
    expect(width()).toBe(240);
  });

  it("restores the persisted width after a remount", () => {
    const first = render(<Sidebar node={node} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "End" });
    expect(localStorage.getItem("bb-canvas:sidebar-width")).toBe("640");
    first.unmount();
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(width()).toBe(640);
  });

  it("clamps an out-of-range or garbage stored width", () => {
    localStorage.setItem("bb-canvas:sidebar-width", "5000");
    const first = render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(width()).toBe(640);
    first.unmount();
    localStorage.setItem("bb-canvas:sidebar-width", "wide");
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(width()).toBe(320);
  });
});
