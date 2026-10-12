// @vitest-environment jsdom
//
// BBP-146: the legacy canvas marks the edge into a running step as "taken
// right now" — a travelling dash on top of the existing "taken" highlight —
// and keeps it static under prefers-reduced-motion. Pinned both ways: where
// it must show, and where it must not.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { graphSchema } from "../lib/graph";
import type { RunDto } from "../server";

vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const graph = graphSchema.parse({
  id: "g",
  name: "Two steps",
  nodes: [
    { id: "a", label: "A", prompt: "x" },
    { id: "b", label: "B", prompt: "y" },
  ],
  edges: [
    { from: "__start__", to: "a" },
    { from: "a", to: "b" },
    { from: "b", to: "__end__" },
  ],
});

const run = (nodeRuns: { nodeId: string; attempt: number; status: "running" | "done" | "failed" | "skipped" }[]) =>
  ({ id: "r", graph, status: "running", threadId: null, createdAt: 0, nodeRuns }) as unknown as RunDto;

function reducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  window.matchMedia = globalThis.matchMedia;
}

describe("liveEdges", () => {
  it("is the edge into the running step only", async () => {
    const { liveEdges } = await import("../components/graph-studio-panel");
    expect([...liveEdges(run([{ nodeId: "a", attempt: 1, status: "done" }, { nodeId: "b", attempt: 1, status: "running" }]))]).toEqual(["a→b"]);
  });
  it("negative: no run, no attempts, nothing running → empty", async () => {
    const { liveEdges } = await import("../components/graph-studio-panel");
    expect(liveEdges(null).size).toBe(0);
    expect(liveEdges(run([])).size).toBe(0);
    expect(liveEdges(run([{ nodeId: "a", attempt: 1, status: "done" }])).size).toBe(0);
  });
});

async function drawEdge(live: boolean) {
  const { LayoutEdgeView } = await import("../components/graph-canvas");
  const { layoutGraph } = await import("../lib/layout");
  const placed = layoutGraph(graph).edges.find((edge) => edge.from === "a" && edge.to === "b")!;
  const { container } = render(
    <svg>
      <LayoutEdgeView
        {...({ id: "e", source: "a", target: "b", sourceX: 0, sourceY: 0, targetX: 0, targetY: 100, sourcePosition: "bottom", targetPosition: "top" } as never)}
        data={{ placed, active: true, live, onInsert: null }}
      />
    </svg>,
  );
  return container;
}

describe("LayoutEdgeView now state", () => {
  it("a live edge draws a travelling primary dash", async () => {
    reducedMotion(false);
    const container = await drawEdge(true);
    const dash = container.querySelector('[data-edge-state="now"]')!;
    expect(dash).not.toBeNull();
    expect(dash.getAttribute("stroke")).toBe("var(--primary)");
    expect(dash.querySelector("animate")?.getAttribute("attributeName")).toBe("stroke-dashoffset");
  });

  it("negative: reduced motion keeps the dash but stops it", async () => {
    reducedMotion(true);
    const container = await drawEdge(true);
    const dash = container.querySelector('[data-edge-state="now"]')!;
    expect(dash).not.toBeNull();
    expect(dash.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(container.querySelector("animate")).toBeNull();
  });

  it("negative: a taken-but-not-live edge has no now dash", async () => {
    reducedMotion(false);
    const container = await drawEdge(false);
    expect(container.querySelector('[data-edge-state="now"]')).toBeNull();
    expect(container.querySelector("animate")).toBeNull();
  });
});
