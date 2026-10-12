// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Sidebar } from "@/components/Sidebar";
import type { CanvasNode } from "@/lib/types";

afterEach(cleanup);

describe("Sidebar", () => {
  it("shows the node's label and kind", () => {
    const node: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.getByText("orch-lead")).toBeTruthy();
    expect(screen.getByText("Member")).toBeTruthy();
  });

  it("shows a status pill with the node's status, capitalized", () => {
    const node: CanvasNode = { id: "c1", kind: "crew", label: "factory-1", status: "running", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("shows no status pill when status is absent", () => {
    const node: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.queryByText("Idle")).toBeNull();
  });

  it("shows a crew node's curated fields, not the raw meta dump", () => {
    const node: CanvasNode = {
      id: "c1",
      kind: "crew",
      label: "factory-1",
      parentId: null,
      meta: { crew: "factory-1", status: "running" },
    };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.getAllByText("Crew").length).toBeGreaterThan(0);
    expect(screen.getAllByText("factory-1").length).toBeGreaterThan(0);
  });

  it("puts a field the kind does not curate into the collapsed Details block", () => {
    const node: CanvasNode = {
      id: "c1",
      kind: "crew",
      label: "factory-1",
      parentId: null,
      meta: { crew: "factory-1", mystery: "x" },
    };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    const details = screen.getByText("Details").closest("details") as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
    expect(within(details).getByText("Mystery")).toBeTruthy();
    expect(within(details).getByText("x")).toBeTruthy();
    // The curated field must not also leak into Details.
    expect(within(details).queryByText("factory-1")).toBeNull();
  });

  it("shows no Details block when every field is curated", () => {
    const node: CanvasNode = {
      id: "c1",
      kind: "crew",
      label: "factory-1",
      parentId: null,
      meta: { crew: "factory-1" },
    };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.queryByText("Details")).toBeNull();
  });

  it("calls onClose when its close button is pressed", () => {
    const onClose = vi.fn();
    const node: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null };
    render(<Sidebar node={node} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("negative (BBP-199): carries the nowheel class so scrolling it does not pan the canvas", () => {
    const node: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Details for orch-lead").className).toContain("nowheel");
  });
});

describe("Sidebar actions", () => {
  it("shows Open thread only when meta.threadId exists, and calls onOpenThread with it", () => {
    const onOpenThread = vi.fn();
    const node: CanvasNode = { id: "t1", kind: "thread", label: "Thread", parentId: null, meta: { threadId: "th1" } };
    render(<Sidebar node={node} onClose={vi.fn()} onOpenThread={onOpenThread} />);
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    expect(onOpenThread).toHaveBeenCalledWith("th1");
  });

  it("shows no Open thread button when meta.threadId is absent", () => {
    const node: CanvasNode = { id: "c1", kind: "crew", label: "factory-1", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} onOpenThread={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Open thread" })).toBeNull();
  });

  it("shows Open run only when meta.runId exists, and calls onOpenRun with it", () => {
    const onOpenRun = vi.fn();
    const node: CanvasNode = { id: "r1", kind: "graph-run", label: "Run", parentId: null, meta: { runId: "run1" } };
    render(<Sidebar node={node} onClose={vi.fn()} onOpenRun={onOpenRun} />);
    fireEvent.click(screen.getByRole("button", { name: "Open run" }));
    expect(onOpenRun).toHaveBeenCalledWith("run1");
  });

  it("shows no Open run button when meta.runId is absent", () => {
    const node: CanvasNode = { id: "s1", kind: "step", label: "Step", parentId: null };
    render(<Sidebar node={node} onClose={vi.fn()} onOpenRun={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Open run" })).toBeNull();
  });

  it("shows Open crew only when meta.crew exists, and calls onOpenCrew with it", () => {
    const onOpenCrew = vi.fn();
    const node: CanvasNode = { id: "c1", kind: "crew", label: "factory-1", parentId: null, meta: { crew: "factory-1" } };
    render(<Sidebar node={node} onClose={vi.fn()} onOpenCrew={onOpenCrew} />);
    fireEvent.click(screen.getByRole("button", { name: "Open crew" }));
    expect(onOpenCrew).toHaveBeenCalledWith("factory-1");
  });

  it("shows no action buttons at all when no callback is given", () => {
    const node: CanvasNode = {
      id: "r1",
      kind: "graph-run",
      label: "Run",
      parentId: null,
      meta: { runId: "run1", threadId: "th1" },
    };
    render(<Sidebar node={node} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Open thread" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open run" })).toBeNull();
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
