// @vitest-environment jsdom
//
// Keyboard navigation over fixture data (BBP-131 WI2) — one test per key, as
// the acceptance criterion asks: each is a real gate, not a smoke test.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CanvasView } from "@/components/CanvasView";
import type { CanvasNode } from "@/lib/types";

afterEach(cleanup);

const nodes: CanvasNode[] = [
  { id: "crew", kind: "crew", label: "factory-1", parentId: null },
  { id: "m1", kind: "member", label: "orch-lead", parentId: "crew" },
  { id: "m2", kind: "member", label: "steps-impl", status: "running", parentId: "crew" },
  { id: "m3", kind: "member", label: "steps-review", parentId: "crew" },
];

function renderView(initialExpanded = new Set(["crew"])) {
  const { container } = render(<CanvasView nodes={nodes} initialExpanded={initialExpanded} />);
  return container.querySelector("[data-canvas-view]") as HTMLElement;
}

function card(name: string) {
  return screen.getByRole("button", { name });
}

describe("CanvasView keyboard navigation", () => {
  it("ArrowDown moves the selection to the next sibling", () => {
    const root = renderView();
    fireEvent.click(card("orch-lead — member"));
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(card("steps-impl — member").getAttribute("aria-pressed")).toBe("true");
  });

  it("ArrowUp moves the selection to the previous sibling", () => {
    const root = renderView();
    fireEvent.click(card("steps-impl — member"));
    fireEvent.keyDown(root, { key: "ArrowUp" });
    expect(card("orch-lead — member").getAttribute("aria-pressed")).toBe("true");
  });

  it("Enter on a collapsed card expands it, and does so only once", () => {
    const root = renderView(new Set());
    fireEvent.click(card("factory-1 — crew"));
    expect(screen.queryByRole("button", { name: "orch-lead — member" })).toBeNull();
    fireEvent.keyDown(root, { key: "Enter" });
    expect(screen.getByRole("button", { name: "orch-lead — member" })).toBeTruthy();
    // Idempotent: pressing it again on the same, now-expanded card must not throw.
    expect(() => fireEvent.keyDown(root, { key: "Enter" })).not.toThrow();
    expect(screen.getAllByRole("button", { name: "orch-lead — member" })).toHaveLength(1);
  });

  it("ArrowLeft collapses an expanded card", () => {
    const root = renderView();
    fireEvent.click(card("factory-1 — crew"));
    expect(screen.getByRole("button", { name: "orch-lead — member" })).toBeTruthy();
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(screen.queryByRole("button", { name: "orch-lead — member" })).toBeNull();
  });

  it("J jumps to the running card", () => {
    const root = renderView();
    fireEvent.keyDown(root, { key: "j" });
    expect(card("steps-impl — member").getAttribute("aria-pressed")).toBe("true");
  });

  it("/ opens the search box", () => {
    const root = renderView();
    fireEvent.keyDown(root, { key: "/" });
    expect(screen.getByRole("textbox", { name: "Search nodes" })).toBeTruthy();
  });

  it("search jumps to and selects the first match", () => {
    const root = renderView();
    fireEvent.keyDown(root, { key: "/" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search nodes" }), {
      target: { value: "steps-review" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search nodes" }), { key: "Enter" });
    expect(card("steps-review — member").getAttribute("aria-pressed")).toBe("true");
  });

  it("search with no match shows 'no match' and does not throw", () => {
    const root = renderView();
    fireEvent.keyDown(root, { key: "/" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search nodes" }), {
      target: { value: "nobody" },
    });
    expect(() =>
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Search nodes" }), { key: "Enter" }),
    ).not.toThrow();
    expect(screen.getByText("no match")).toBeTruthy();
  });

  it("Escape closes the search box", () => {
    const root = renderView();
    fireEvent.keyDown(root, { key: "/" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search nodes" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Search nodes" })).toBeNull();
  });

  it("selecting a card opens the sidebar, and Escape closes it", () => {
    const root = renderView();
    fireEvent.click(card("orch-lead — member"));
    expect(screen.getByLabelText("Details for orch-lead")).toBeTruthy();
    fireEvent.keyDown(root, { key: "Escape" });
    expect(screen.queryByLabelText("Details for orch-lead")).toBeNull();
  });

  it("shows the breadcrumb for the selected card", () => {
    renderView();
    fireEvent.click(card("orch-lead — member"));
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toBeTruthy();
    expect(breadcrumb.textContent).toContain("factory-1");
    expect(breadcrumb.textContent).toContain("orch-lead");
  });

  it("0, + and - do not throw even though no DOM measurement is available", () => {
    const root = renderView();
    expect(() => {
      fireEvent.keyDown(root, { key: "0" });
      fireEvent.keyDown(root, { key: "+" });
      fireEvent.keyDown(root, { key: "-" });
    }).not.toThrow();
  });
});
