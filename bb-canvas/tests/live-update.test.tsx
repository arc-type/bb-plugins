// @vitest-environment jsdom
//
// BBP-200: a polled tree arrives as fresh arrays every few seconds. It must
// update in place — animated when allowed, and never at the cost of the
// user's selection, expanded cards or viewport.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CanvasShell } from "@/components/CanvasShell";
import { CanvasView } from "@/components/CanvasView";
import { MOTION_ENTER, MOTION_EXIT, MOTION_MS } from "@/lib/tree-motion";
import type { CanvasNode } from "@/lib/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const tree = (...members: string[]): CanvasNode[] => [
  { id: "crew", kind: "crew", label: "factory-1", parentId: null },
  ...members.map((id) => ({ id, kind: "member", label: id, parentId: "crew" })),
];

function flowNode(id: string): HTMLElement | null {
  return document.querySelector(`.react-flow__node[data-id="${id}"]`);
}

function reducedMotion(on: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: on && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("CanvasShell live updates", () => {
  it("fades a new node in and lets a removed one fade out before it goes", () => {
    vi.useFakeTimers();
    reducedMotion(false);
    const expanded = new Set(["crew"]);
    const { rerender } = render(<CanvasShell nodes={tree("a", "b")} expanded={expanded} />);
    expect(flowNode("a")!.className).not.toContain(MOTION_ENTER);
    rerender(<CanvasShell nodes={tree("a", "c")} expanded={expanded} />);
    expect(flowNode("c")!.className).toContain(MOTION_ENTER);
    expect(flowNode("b")!.className).toContain(MOTION_EXIT);
    act(() => void vi.advanceTimersByTime(MOTION_MS + 10));
    expect(flowNode("b")).toBeNull();
    expect(flowNode("a")).not.toBeNull();
  });

  it("with prefers-reduced-motion: no animation, the removed node is gone at once", () => {
    reducedMotion(true);
    const expanded = new Set(["crew"]);
    const { rerender } = render(<CanvasShell nodes={tree("a", "b")} expanded={expanded} />);
    rerender(<CanvasShell nodes={tree("a", "c")} expanded={expanded} />);
    expect(flowNode("c")!.className).not.toContain(MOTION_ENTER);
    expect(flowNode("b")).toBeNull();
  });
});

describe("CanvasView live updates", () => {
  it("keeps selection, expanded cards and viewport across an unchanged poll", () => {
    const { rerender } = render(<CanvasView nodes={tree("a", "b")} initialExpanded={new Set(["crew"])} />);
    fireEvent.click(screen.getByRole("button", { name: /^a — / }));
    const viewport = () => (document.querySelector(".react-flow__viewport") as HTMLElement).style.transform;
    const before = viewport();
    rerender(<CanvasView nodes={tree("a", "b")} initialExpanded={new Set(["crew"])} />);
    expect(screen.getByRole("button", { name: /^a — / }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^b — / })).toBeTruthy();
    expect(viewport()).toBe(before);
  });

  it("drops the selection and the sidebar when the selected node disappears", () => {
    const { rerender } = render(<CanvasView nodes={tree("a", "b")} initialExpanded={new Set(["crew"])} />);
    fireEvent.click(screen.getByRole("button", { name: /^b — / }));
    expect(screen.getByLabelText("Details for b")).toBeTruthy();
    rerender(<CanvasView nodes={tree("a")} initialExpanded={new Set(["crew"])} />);
    // Comes back: must not reappear selected, the selection was dropped.
    rerender(<CanvasView nodes={tree("a", "b")} initialExpanded={new Set(["crew"])} />);
    expect(screen.getByRole("button", { name: /^b — / }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByLabelText("Details for b")).toBeNull();
  });
});
