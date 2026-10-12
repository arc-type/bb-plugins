// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StatusEdge, type StatusEdgeData } from "@/components/StatusEdge";

afterEach(cleanup);

function edge(data: StatusEdgeData) {
  const { container } = render(
    <svg>
      <StatusEdge data={data} id="e1" source="a" target="b" />
    </svg>,
  );
  return container.querySelector("path.react-flow__edge-path")!;
}

describe("StatusEdge state (BBP-146)", () => {
  it("draws a plain border line without a state", () => {
    const path = edge({ variant: "flow", path: "M 0 0 L 1 1", label: "" });
    expect(path.style.stroke).toBe("var(--border)");
    expect(path.getAttribute("class")).not.toContain("bb-canvas-edge-now");
  });

  it("draws a solid primary line when taken", () => {
    const path = edge({ variant: "flow", path: "M 0 0 L 1 1", label: "", state: "taken" });
    expect(path.style.stroke).toBe("var(--primary)");
    expect(path.style.strokeWidth).toBe("2");
    expect(path.getAttribute("class")).not.toContain("bb-canvas-edge-now");
  });

  it("animates a travelling dash when now", () => {
    const path = edge({ variant: "flow", path: "M 0 0 L 1 1", label: "", state: "now" });
    expect(path.style.stroke).toBe("var(--primary)");
    expect(path.getAttribute("class")).toContain("bb-canvas-edge-now");
  });

  it("never carries a state on a message edge", () => {
    const path = edge({ variant: "message", path: "M 0 0 L 1 1", label: "" });
    expect(path.getAttribute("class")).not.toContain("bb-canvas-edge-now");
    expect(path.style.strokeDasharray).toBe("4 4");
  });

  it("injects its keyframes once, no matter how many edges render", () => {
    edge({ variant: "flow", path: "M 0 0 L 1 1", label: "", state: "now" });
    edge({ variant: "flow", path: "M 0 0 L 1 1", label: "", state: "now" });
    expect(document.querySelectorAll("#bb-canvas-status-edge-styles")).toHaveLength(1);
  });
});

describe("StatusEdge relation hover (BBP-197 design)", () => {
  // React Flow gives unselectable edges pointer-events: none; a relation
  // must take them back on its own group, or hover never reaches it.
  it("a relation edge takes pointer events on its stroke", () => {
    const group = edge({ variant: "flow", path: "M 0 0 L 1 1", label: "assigns_to", relation: true }).closest("g")!;
    expect(group.style.pointerEvents).toBe("stroke");
  });

  it("negative: any other edge leaves pointer events to React Flow", () => {
    const group = edge({ variant: "flow", path: "M 0 0 L 1 1", label: "" }).closest("g")!;
    expect(group.style.pointerEvents).toBe("");
  });
});
