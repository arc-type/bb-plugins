// @vitest-environment jsdom
//
// Keyboard navigation over fixture data (BBP-131 WI2) — one test per key, as
// the acceptance criterion asks: each is a real gate, not a smoke test.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CanvasView } from "@/components/CanvasView";
import type { CanvasFrame, CanvasNode } from "@/lib/types";

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

function card(name: string | RegExp) {
  return screen.getByRole("button", { name });
}

describe("CanvasView keyboard navigation", () => {
  it("ArrowDown moves the selection to the next sibling", () => {
    const root = renderView();
    fireEvent.click(card(new RegExp("^orch-lead — ")));
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(card(new RegExp("^steps-impl — ")).getAttribute("aria-pressed")).toBe("true");
  });

  it("ArrowUp moves the selection to the previous sibling", () => {
    const root = renderView();
    fireEvent.click(card(new RegExp("^steps-impl — ")));
    fireEvent.keyDown(root, { key: "ArrowUp" });
    expect(card(new RegExp("^orch-lead — ")).getAttribute("aria-pressed")).toBe("true");
  });

  it("Enter on a collapsed card expands it, and does so only once", () => {
    const root = renderView(new Set());
    fireEvent.click(card(new RegExp("^factory-1 — ")));
    expect(screen.queryByRole("button", { name: new RegExp("^orch-lead — ") })).toBeNull();
    fireEvent.keyDown(root, { key: "Enter" });
    expect(screen.getByRole("button", { name: new RegExp("^orch-lead — ") })).toBeTruthy();
    // Idempotent: pressing it again on the same, now-expanded card must not throw.
    expect(() => fireEvent.keyDown(root, { key: "Enter" })).not.toThrow();
    expect(screen.getAllByRole("button", { name: new RegExp("^orch-lead — ") })).toHaveLength(1);
  });

  it("ArrowLeft collapses an expanded card", () => {
    const root = renderView();
    fireEvent.click(card(new RegExp("^factory-1 — ")));
    expect(screen.getByRole("button", { name: new RegExp("^orch-lead — ") })).toBeTruthy();
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(screen.queryByRole("button", { name: new RegExp("^orch-lead — ") })).toBeNull();
  });

  it("J jumps to the running card", () => {
    const root = renderView();
    fireEvent.keyDown(root, { key: "j" });
    expect(card(new RegExp("^steps-impl — ")).getAttribute("aria-pressed")).toBe("true");
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
    expect(card(new RegExp("^steps-review — ")).getAttribute("aria-pressed")).toBe("true");
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
    fireEvent.click(card(new RegExp("^orch-lead — ")));
    expect(screen.getByLabelText("Details for orch-lead")).toBeTruthy();
    fireEvent.keyDown(root, { key: "Escape" });
    expect(screen.queryByLabelText("Details for orch-lead")).toBeNull();
  });

  it("shows the breadcrumb for the selected card", () => {
    renderView();
    fireEvent.click(card(new RegExp("^orch-lead — ")));
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

describe("CanvasView run/edit mode (BBP-166)", () => {
  const frameNodes: CanvasNode[] = [
    { id: "crew", kind: "crew", label: "factory-1", parentId: null },
    { id: "lead", kind: "member", label: "orch-lead", parentId: "crew", frameId: "frame-a" },
    { id: "m1", kind: "member", label: "steps-impl", parentId: "crew", frameId: "frame-a" },
    { id: "m2", kind: "member", label: "steps-review", parentId: "crew", frameId: "frame-b" },
    { id: "outside", kind: "member", label: "outsider", parentId: "crew" },
  ];
  const frames: CanvasFrame[] = [
    { id: "frame-a", parentId: null, label: "Team A" },
    { id: "frame-b", parentId: null, label: "Team B" },
  ];

  function renderEditableView() {
    const { container } = render(
      <CanvasView
        nodes={frameNodes}
        frames={frames}
        editableFrameIds={new Set(["frame-a"])}
        initialExpanded={new Set(["crew"])}
      />,
    );
    return container.querySelector("[data-canvas-view]") as HTMLElement;
  }

  it("E on a card inside an editable frame dims every card outside it and locks their clicks", () => {
    const root = renderEditableView();
    fireEvent.click(card(new RegExp("^orch-lead — ")));
    fireEvent.keyDown(root, { key: "e" });
    const outsider = card(new RegExp("^outsider — "));
    expect(outsider.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(outsider);
    expect(outsider.getAttribute("aria-pressed")).toBe("false");
    const member = card(new RegExp("^steps-impl — "));
    expect(member.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("E on a card whose frame is not editable does nothing", () => {
    const root = renderEditableView();
    fireEvent.click(card(new RegExp("^steps-review — ")));
    fireEvent.keyDown(root, { key: "e" });
    const outsider = card(new RegExp("^outsider — "));
    expect(outsider.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("E with no card selected does nothing", () => {
    const root = renderEditableView();
    fireEvent.keyDown(root, { key: "e" });
    const outsider = card(new RegExp("^outsider — "));
    expect(outsider.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("Escape exits edit mode and un-dims every card (priority over the plain deselect)", () => {
    const root = renderEditableView();
    fireEvent.click(card(new RegExp("^orch-lead — ")));
    fireEvent.keyDown(root, { key: "e" });
    fireEvent.keyDown(root, { key: "Escape" });
    expect(card(new RegExp("^outsider — ")).getAttribute("aria-disabled")).not.toBe("true");
  });

  it("a nested E — selecting a card in a second frame while already editing — is ignored", () => {
    const root = renderEditableView();
    fireEvent.click(card(new RegExp("^orch-lead — ")));
    fireEvent.keyDown(root, { key: "e" });
    // frame-b is not editable, but even if it were, entering edit mode a
    // second level deep must not happen without an Escape first.
    fireEvent.click(card(new RegExp("^steps-review — ")));
    fireEvent.keyDown(root, { key: "e" });
    // Still editing frame-a: steps-impl (frame-a) stays undimmed, outsider stays dimmed.
    expect(card(new RegExp("^steps-impl — ")).getAttribute("aria-disabled")).not.toBe("true");
    expect(card(new RegExp("^outsider — ")).getAttribute("aria-disabled")).toBe("true");
  });

  it("forces type colour mode while editing, without touching the saved status/type preference", () => {
    const root = renderEditableView();
    const neutral = card(new RegExp("^steps-impl — "));
    expect(neutral.style.border).toContain("var(--border)"); // starts in status mode, neutral
    fireEvent.click(card(new RegExp("^orch-lead — ")));
    fireEvent.keyDown(root, { key: "e" });
    expect(card(new RegExp("^steps-impl — ")).style.border).not.toContain("var(--border)");
    fireEvent.keyDown(root, { key: "Escape" });
    expect(card(new RegExp("^steps-impl — ")).style.border).toContain("var(--border)");
  });
});

describe("CanvasView lazy children", () => {
  it("loads a node's children on first expand and renders them once they resolve", async () => {
    const loadChildren = vi.fn(async (node: CanvasNode) => ({
      nodes: [{ id: `${node.id}:turn-1`, kind: "turn" as const, label: "Turn 1", parentId: node.id }],
    }));
    const { container } = render(
      <CanvasView nodes={nodes} initialExpanded={new Set(["crew"])} loadChildren={loadChildren} />,
    );
    const root = container.querySelector("[data-canvas-view]") as HTMLElement;
    fireEvent.click(card(new RegExp("^orch-lead — ")));
    fireEvent.keyDown(root, { key: "Enter" });
    expect(loadChildren).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
    expect(await screen.findByRole("button", { name: /^Turn 1 — / })).toBeTruthy();
  });

  it("does not call the loader twice for the same node", async () => {
    const loadChildren = vi.fn(async (node: CanvasNode) => ({
      nodes: [{ id: `${node.id}:turn-1`, kind: "turn" as const, label: "Turn 1", parentId: node.id }],
    }));
    const { container } = render(
      <CanvasView nodes={nodes} initialExpanded={new Set(["crew"])} loadChildren={loadChildren} />,
    );
    const root = container.querySelector("[data-canvas-view]") as HTMLElement;
    fireEvent.click(card(new RegExp("^orch-lead — ")));
    fireEvent.keyDown(root, { key: "Enter" });
    await screen.findByRole("button", { name: /^Turn 1 — / });
    fireEvent.keyDown(root, { key: "Enter" });
    expect(loadChildren).toHaveBeenCalledOnce();
  });
});
