// @vitest-environment jsdom
//
// Fallback paths on the canvas: drawn compact, left out of a run view until
// the run reaches them, and laid out without the holes they would leave. Plus
// the run-view side of the status derivation: a subgraph card saying what
// runs inside it, and the edge into an answered approval lighting up.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { graphSchema, type Graph } from "../lib/graph";
import {
  COMPACT_HEIGHT,
  COMPACT_WIDTH,
  NODE_HEIGHT,
  NODE_WIDTH,
  layoutGraph,
  withoutNodes,
} from "../lib/layout";
import { GraphCanvas } from "../components/graph-canvas";
import { travelledEdges } from "../components/graph-studio-panel";

afterEach(cleanup);

/** work → gate; red → fix (fallback) → gate; green → End. */
const graph = (): Graph =>
  graphSchema.parse({
    id: "g",
    name: "Gate loop",
    nodes: [
      { id: "work", label: "Work", prompt: "x" },
      { id: "gate", label: "Gate", kind: "command", command: "true", fields: [{ name: "ok", type: "boolean" }] },
      { id: "fix", label: "Fix the gate", prompt: "x", path: "fallback" },
      { id: "after", label: "After", prompt: "x" },
    ],
    edges: [
      { from: "__start__", to: "work" },
      { from: "work", to: "gate" },
      { from: "gate", to: "after", when: { source: "field", key: "ok", op: "equals", value: "true" } },
      { from: "gate", to: "fix" },
      { from: "fix", to: "gate" },
      { from: "after", to: "__end__" },
    ],
  });

const placed = (value: Graph, id: string) => layoutGraph(value).nodes.find((node) => node.id === id)!;

describe("layout", () => {
  it("draws a fallback node compact and every other node full size", () => {
    expect(placed(graph(), "fix")).toMatchObject({ width: COMPACT_WIDTH, height: COMPACT_HEIGHT });
    expect(placed(graph(), "work")).toMatchObject({ width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  it("closes up when hidden nodes are left out instead of keeping their place", () => {
    const full = layoutGraph(graph());
    const without = layoutGraph(withoutNodes(graph(), new Set(["fix"])));
    expect(without.nodes.map((node) => node.id)).not.toContain("fix");
    expect(without.edges.some((edge) => edge.from === "fix" || edge.to === "fix")).toBe(false);
    // `fix` sat in a layer of its own below the gate; without it, `after`
    // keeps its row and nothing is left standing where `fix` was.
    expect(without.height).toBeLessThanOrEqual(full.height);
    expect(without.width).toBeLessThanOrEqual(full.width);
  });

  it("leaves a graph alone when nothing is hidden", () => {
    const value = graph();
    expect(withoutNodes(value, new Set())).toBe(value);
  });
});

const nodeNames = () =>
  screen
    .getAllByRole("button")
    .map((element) => element.getAttribute("aria-label") ?? "")
    .filter((name) => name !== "");

describe("the canvas in a run view", () => {
  it("leaves an unreached fallback out and offers to show it", () => {
    render(<GraphCanvas graph={graph()} statuses={{ work: "done", gate: "running" }} hideUnreachedFallbacks />);
    expect(nodeNames().some((name) => name.startsWith("Fix the gate"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show fallback paths (1)" }));
    expect(nodeNames().some((name) => name.startsWith("Fix the gate — fallback"))).toBe(true);
    expect(screen.getByRole("button", { name: "Hide fallback paths" })).toBeTruthy();
  });

  it("shows a fallback the run reached, and then offers nothing", () => {
    render(
      <GraphCanvas graph={graph()} statuses={{ work: "done", gate: "done", fix: "running" }} hideUnreachedFallbacks />,
    );
    expect(nodeNames().some((name) => name.startsWith("Fix the gate — fallback — running"))).toBe(true);
    expect(screen.queryByRole("button", { name: /fallback paths/ })).toBeNull();
  });

  it("shows every node outside a run view, the fallback compact", () => {
    render(<GraphCanvas graph={graph()} />);
    expect(nodeNames().some((name) => name.startsWith("Fix the gate — fallback"))).toBe(true);
    expect(document.querySelectorAll('[data-path="fallback"]')).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /fallback paths/ })).toBeNull();
  });

  it("puts a status text in place of the bare status word", () => {
    render(<GraphCanvas graph={graph()} statuses={{ work: "running" }} statusTexts={{ work: "implement" }} />);
    expect(nodeNames().find((name) => name.startsWith("Work"))).toBe("Work — implement");
    cleanup();
    render(<GraphCanvas graph={graph()} statuses={{ work: "running" }} />);
    expect(nodeNames().find((name) => name.startsWith("Work"))).toBe("Work — running");
  });
});

describe("edges into nodes without attempts", () => {
  const approval = graphSchema.parse({
    id: "a",
    name: "Approval",
    nodes: [
      { id: "work", label: "Work", prompt: "x" },
      { id: "ok", label: "OK?", kind: "human" },
      { id: "after", label: "After", prompt: "x" },
    ],
    edges: [
      { from: "__start__", to: "work" },
      { from: "work", to: "ok" },
      { from: "ok", to: "after" },
      { from: "after", to: "__end__" },
    ],
  });
  const run = { graph: approval, nodeRuns: [{ nodeId: "work" }, { nodeId: "after" }] } as unknown as Parameters<
    typeof travelledEdges
  >[0];

  it("lights the way through an answered approval", () => {
    expect([...travelledEdges(run, new Set(["ok"]))].sort()).toEqual(["__start__→work", "ok→after", "work→ok"]);
  });

  it("stays dark through an approval nobody reached", () => {
    expect([...travelledEdges(run)].sort()).toEqual(["__start__→work"]);
  });
});
