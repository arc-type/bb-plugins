// @vitest-environment jsdom
// BBP-202: the "Relations" toggle in CanvasView's toolbar. jsdom draws no
// React Flow edges, so the shell is stubbed to report the edges it gets.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { forwardRef } from "react";
import type { CanvasEdge, CanvasNode } from "@/lib/types";

vi.mock("@/components/CanvasShell", () => ({
  CanvasShell: forwardRef(function Stub({ edges = [] }: { edges?: CanvasEdge[] }, _ref) {
    return <output data-testid="edges">{JSON.stringify(edges)}</output>;
  }),
}));

const { CanvasView } = await import("@/components/CanvasView");
const { relationsStorageKey } = await import("@/lib/relations");

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const nodes: CanvasNode[] = [
  { id: "crew", kind: "crew", label: "trio", parentId: null },
  { id: "a", kind: "member", label: "lead", parentId: "crew" },
  { id: "b", kind: "member", label: "dev", parentId: "crew" },
];
const ab: CanvasEdge = { from: "a", to: "b", variant: "flow", label: "assigns_to", relation: true };
const message: CanvasEdge = { from: "b", to: "a", variant: "message", label: "2" };

const view = (surface = "s", edges = [ab, message]) =>
  render(<CanvasView nodes={nodes} edges={edges} initialExpanded={new Set(["crew"])} surface={surface} />);
const toggle = () => screen.getByRole("button", { name: "Relations" });
const shown = (): CanvasEdge[] => JSON.parse(screen.getByTestId("edges").textContent!);

describe("Relations toggle", () => {
  it("negative: off by default — no relation edge reaches the canvas, the others do", () => {
    view();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(shown()).toEqual([message]);
  });

  it("on shows every relation edge and is remembered per surface", () => {
    view();
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(shown()).toEqual([ab, message]);
    expect(localStorage.getItem(relationsStorageKey("s"))).toBe("on");
    cleanup();
    view();
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    cleanup();
    view("other");
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("a selected member shows its relations highlighted even with the toggle off", () => {
    view();
    fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "ArrowDown" });
    fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "ArrowRight" });
    expect(shown()).toEqual([{ ...ab, emphasis: "highlight" }, message]);
  });

  it("negative: no toggle when there are no relation edges", () => {
    view("s", [message]);
    expect(screen.queryByRole("button", { name: "Relations" })).toBeNull();
  });
});
