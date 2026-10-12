// @vitest-environment jsdom
//
// Expand/collapse (BBP-183): a chevron on every card that can open, none on
// a leaf, a child-count badge while collapsed, Right/Left/Enter, per-surface
// persistence, and Collapse all / Expand all without lazy loads.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CanvasView } from "@/components/CanvasView";
import { expandedStorageKey, loadExpandedState, restoreExpanded, withToggle } from "@/lib/expanded-state";
import type { CanvasNode } from "@/lib/types";

const nodes: CanvasNode[] = [
  { id: "crew", kind: "crew", label: "factory-1", parentId: null },
  { id: "m1", kind: "member", label: "orch-lead", parentId: "crew" },
  { id: "m2", kind: "member", label: "steps-impl", parentId: "crew" },
  { id: "run", kind: "graph-run", label: "review-flow", parentId: "m1" },
  { id: "s1", kind: "step", label: "plan", parentId: "run" },
  { id: "t1", kind: "thread", label: "Thread", parentId: "m2", meta: { threadId: "t1" } },
];

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const card = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label} — `) });
const queryCard = (label: string) => screen.queryByRole("button", { name: new RegExp(`^${label} — `) });
const chevron = (label: string) => screen.queryByRole("button", { name: new RegExp(`^(Expand|Collapse) ${label}\\b`) });

function renderView(props: Partial<React.ComponentProps<typeof CanvasView>> = {}) {
  const { container } = render(<CanvasView nodes={nodes} initialExpanded={new Set(["crew"])} {...props} />);
  return container.querySelector("[data-canvas-view]") as HTMLElement;
}

describe("expanded-state (pure)", () => {
  it("uses initialExpanded when nothing is stored", () => {
    expect([...restoreExpanded(["a", "b"], null)].sort()).toEqual(["a", "b"]);
  });

  it("applies stored opens and closes on top of initialExpanded", () => {
    expect([...restoreExpanded(["a", "b"], { open: ["c"], closed: ["a"] })].sort()).toEqual(["b", "c"]);
  });

  it("a toggle moves an id between open and closed", () => {
    const opened = withToggle({ open: [], closed: ["a"] }, "a", true);
    expect(opened).toEqual({ open: ["a"], closed: [] });
    expect(withToggle(opened, "a", false)).toEqual({ open: [], closed: ["a"] });
  });

  it("negative: a malformed or blocked entry reads as nothing stored", () => {
    localStorage.setItem(expandedStorageKey("s"), "{nope");
    expect(loadExpandedState("s")).toBeNull();
    localStorage.setItem(expandedStorageKey("s"), '{"open":"x"}');
    expect(loadExpandedState("s")).toBeNull();
  });
});

describe("chevron", () => {
  it("shows on a card with children and toggles it on click", () => {
    renderView();
    expect(queryCard("review-flow")).toBeNull();
    fireEvent.click(chevron("orch-lead")!);
    expect(card("review-flow")).toBeTruthy();
    expect(chevron("orch-lead")!.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(chevron("orch-lead")!);
    expect(queryCard("review-flow")).toBeNull();
  });

  it("shows on a lazily loadable card before its children arrive", () => {
    renderView({ loadChildren: async () => ({ nodes: [] }), canLoadChildren: (node) => node.kind === "thread" });
    fireEvent.click(chevron("steps-impl")!);
    expect(chevron("Thread")).toBeTruthy();
  });

  it("negative: a leaf card has no chevron", () => {
    renderView({ initialExpanded: new Set(["crew", "m1", "run"]) });
    expect(card("plan")).toBeTruthy();
    expect(chevron("plan")).toBeNull();
  });

  it("negative: a node the page says cannot load gets no chevron, even with a loader", () => {
    renderView({
      initialExpanded: new Set(["crew", "m1", "run"]),
      loadChildren: async () => ({ nodes: [] }),
      canLoadChildren: (node) => node.kind === "thread",
    });
    expect(chevron("plan")).toBeNull();
  });

  it("a collapsed card shows its child count, an expanded one does not", () => {
    renderView({ initialExpanded: new Set() });
    expect(chevron("factory-1")!.textContent).toContain("2");
    expect(chevron("factory-1")!.getAttribute("aria-label")).toBe("Expand factory-1 (2 children)");
    fireEvent.click(chevron("factory-1")!);
    expect(chevron("factory-1")!.textContent).not.toContain("2");
  });

  it("a chevron click does not select the card", () => {
    renderView();
    fireEvent.click(chevron("orch-lead")!);
    expect(card("orch-lead").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("keyboard on a leaf", () => {
  it("negative: Right and Enter do not open a leaf, Left goes to its parent", () => {
    const root = renderView({ initialExpanded: new Set(["crew", "m1", "run"]) });
    fireEvent.click(card("plan"));
    fireEvent.keyDown(root, { key: "Enter" });
    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(card("plan").getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(card("review-flow").getAttribute("aria-pressed")).toBe("true");
    expect(card("plan")).toBeTruthy();
  });

  it("negative: a leaf never reaches the loader, even with one given", () => {
    const loadChildren = vi.fn(async () => ({ nodes: [] }));
    const root = renderView({
      initialExpanded: new Set(["crew", "m1", "run"]),
      loadChildren,
      canLoadChildren: (node) => node.kind === "thread",
    });
    fireEvent.click(card("plan"));
    fireEvent.keyDown(root, { key: "Enter" });
    expect(loadChildren).not.toHaveBeenCalled();
  });
});

describe("persistence per surface", () => {
  it("restores the expanded state after a remount", () => {
    renderView({ surface: "test" });
    fireEvent.click(chevron("orch-lead")!);
    fireEvent.click(chevron("factory-1")!);
    cleanup();
    renderView({ surface: "test" });
    expect(queryCard("orch-lead")).toBeNull();
    fireEvent.click(chevron("factory-1")!);
    expect(card("review-flow")).toBeTruthy();
  });

  it("negative: another surface does not see it", () => {
    renderView({ surface: "a" });
    fireEvent.click(chevron("factory-1")!);
    cleanup();
    renderView({ surface: "b" });
    expect(card("orch-lead")).toBeTruthy();
  });

  it("negative: without a surface nothing is stored", () => {
    renderView();
    fireEvent.click(chevron("factory-1")!);
    expect(localStorage.length).toBe(0);
  });
});

describe("Collapse all / Expand all", () => {
  it("Expand all opens every card with known children, without lazy loads", () => {
    const loadChildren = vi.fn(async () => ({ nodes: [] }));
    renderView({ initialExpanded: new Set(), loadChildren, canLoadChildren: (node) => node.kind === "thread" });
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(card("plan")).toBeTruthy();
    expect(card("Thread")).toBeTruthy();
    expect(chevron("Thread")!.getAttribute("aria-expanded")).toBe("false");
    expect(loadChildren).not.toHaveBeenCalled();
  });

  it("Collapse all closes the whole tree down to its roots", () => {
    renderView({ initialExpanded: new Set(["crew", "m1", "run"]) });
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(card("factory-1")).toBeTruthy();
    expect(queryCard("orch-lead")).toBeNull();
    fireEvent.click(chevron("factory-1")!);
    expect(queryCard("review-flow")).toBeNull();
  });
});
