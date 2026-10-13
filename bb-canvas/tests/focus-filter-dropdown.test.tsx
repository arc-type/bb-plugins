// @vitest-environment jsdom
//
// The toolbar's Focus dropdown (BBP-240): built from crew/graph-run/thread
// nodes, grouped, "All"/"Focus (n)" label scheme.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FocusFilter } from "@/components/FocusFilter";
import type { CanvasNode } from "@/lib/types";

afterEach(cleanup);

const nodes: CanvasNode[] = [
  { id: "crew:alpha", kind: "crew", label: "Alpha", parentId: "agents" },
  {
    id: "member:a@alpha",
    kind: "member",
    label: "a",
    parentId: "crew:alpha",
    meta: { address: "a@alpha" },
  },
  {
    id: "member:b@alpha",
    kind: "member",
    label: "b",
    parentId: "crew:alpha",
    meta: { address: "b@alpha" },
  },
  { id: "run:r1", kind: "graph-run", label: "Nightly run", parentId: "agents" },
  { id: "thread:t1", kind: "thread", label: "Fix login bug", parentId: "agents", meta: { threadId: "thr_abc123" } },
  { id: "step:s1", kind: "step", label: "Step 1", parentId: "run:r1" },
];

describe("FocusFilter", () => {
  it("says All when nothing is focused", () => {
    render(<FocusFilter nodes={nodes} selected={[]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
  });

  it("says Focus (n) once nodes are selected", () => {
    render(<FocusFilter nodes={nodes} selected={["crew:alpha", "run:r1"]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Focus (2)" })).toBeTruthy();
  });

  it("groups options as Crews, Graph runs and Threads, offering only those kinds", () => {
    render(<FocusFilter nodes={nodes} selected={[]} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    const group = screen.getByRole("group", { name: "Focus" });
    expect(Array.from(group.querySelectorAll('[role="presentation"]')).map((node) => node.textContent)).toEqual([
      "Crews",
      "Graph runs",
      "Threads",
    ]);
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Nightly run" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Fix login bug" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Step 1" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "a" })).toBeNull();
  });

  it("searches a thread by its thread id", () => {
    render(<FocusFilter nodes={nodes} selected={[]} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "abc123" } });
    expect(screen.getByRole("checkbox", { name: "Fix login bug" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Alpha" })).toBeNull();
  });

  it("searches a crew by its members' member@crew strings", () => {
    render(<FocusFilter nodes={nodes} selected={[]} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "b@alpha" } });
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Nightly run" })).toBeNull();
  });

  it("toggles a selection on and off", () => {
    const onChange = vi.fn();
    render(<FocusFilter nodes={nodes} selected={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    expect(onChange).toHaveBeenLastCalledWith(["crew:alpha"]);
  });
});
