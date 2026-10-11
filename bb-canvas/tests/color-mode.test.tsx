// @vitest-environment jsdom
//
// The Status/Type colour toggle (BBP-146 WI4): persisted in localStorage,
// defaults to "status", never throws when storage is missing or empty.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CanvasView } from "@/components/CanvasView";
import type { CanvasNode } from "@/lib/types";

const nodes: CanvasNode[] = [
  { id: "crew", kind: "crew", label: "factory-1", parentId: null },
  { id: "m1", kind: "member", label: "orch-lead", parentId: "crew" },
];

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe("colour mode toggle", () => {
  it("defaults to Status", () => {
    render(<CanvasView nodes={nodes} initialExpanded={new Set(["crew"])} />);
    expect(screen.getByRole("button", { name: /Colour: Status/ })).toBeTruthy();
  });

  it("switches to Type on click, and the card border changes", () => {
    render(<CanvasView nodes={nodes} initialExpanded={new Set(["crew"])} />);
    fireEvent.click(screen.getByRole("button", { name: /Colour: Status/ }));
    expect(screen.getByRole("button", { name: /Colour: Type/ })).toBeTruthy();
    const card = screen.getByRole("button", { name: new RegExp("^orch-lead — ") });
    expect(card.style.border).not.toContain("var(--border)");
  });

  it("persists the choice across a remount, as a reload would see it", () => {
    const { unmount } = render(<CanvasView nodes={nodes} initialExpanded={new Set(["crew"])} />);
    fireEvent.click(screen.getByRole("button", { name: /Colour: Status/ }));
    unmount();
    render(<CanvasView nodes={nodes} initialExpanded={new Set(["crew"])} />);
    expect(screen.getByRole("button", { name: /Colour: Type/ })).toBeTruthy();
  });

  it("falls back to Status when localStorage throws (e.g. private mode)", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(() =>
        render(<CanvasView nodes={nodes} initialExpanded={new Set(["crew"])} />),
      ).not.toThrow();
      expect(screen.getByRole("button", { name: /Colour: Status/ })).toBeTruthy();
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it("falls back to Status for an unrecognised stored value", () => {
    localStorage.setItem("bb-canvas:colour-mode", "nonsense");
    render(<CanvasView nodes={nodes} initialExpanded={new Set(["crew"])} />);
    expect(screen.getByRole("button", { name: /Colour: Status/ })).toBeTruthy();
  });
});
