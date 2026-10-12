// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CanvasShell, colorLightness } from "@/components/CanvasShell";
import type { CanvasEdge, CanvasFrame, CanvasNode } from "@/lib/types";

afterEach(cleanup);

const nodes: CanvasNode[] = [
  { id: "crew", kind: "crew", label: "factory-1", parentId: null },
  { id: "m1", kind: "member", label: "orch-lead", status: "running", parentId: "crew" },
  { id: "m2", kind: "member", label: "steps-impl", parentId: "crew" },
];

const edges: CanvasEdge[] = [{ from: "m2", to: "m1", variant: "message", label: "2" }];

describe("CanvasShell", () => {
  it("renders a card for every visible node", () => {
    render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    expect(screen.getByRole("button", { name: new RegExp("^orch-lead — ") })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp("^steps-impl — ") })).toBeTruthy();
  });

  it("hides the children of a collapsed node", () => {
    render(<CanvasShell nodes={nodes} expanded={new Set()} edges={edges} />);
    expect(screen.queryByRole("button", { name: new RegExp("^orch-lead — ") })).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp("^factory-1 — ") })).toBeTruthy();
  });

  it("calls onSelect with the clicked node's id", () => {
    const onSelect = vi.fn();
    render(
      <CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp("^orch-lead — ") }));
    expect(onSelect).toHaveBeenCalledWith("m1");
  });

  it("marks the selected node pressed", () => {
    render(
      <CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} selectedId="m1" />,
    );
    expect(
      screen.getByRole("button", { name: new RegExp("^orch-lead — ") }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("borders a running card by status by default", () => {
    render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const card = screen.getByRole("button", { name: new RegExp("^orch-lead — ") });
    expect(card.className).toContain("bb-canvas-pulse");
  });

  it("tints a neutral card by kind when colorMode is 'type'", () => {
    render(
      <CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} colorMode="type" />,
    );
    const card = screen.getByRole("button", { name: new RegExp("^steps-impl — ") });
    expect(card.style.border).not.toContain("var(--border)");
  });
});

describe("CanvasShell frames (BBP-165)", () => {
  it("renders a frame's label behind its member cards", () => {
    const framedNodes: CanvasNode[] = nodes.map((node) =>
      node.id === "m1" || node.id === "m2" ? { ...node, frameId: "frame-crew" } : node,
    );
    const frames: CanvasFrame[] = [{ id: "frame-crew", parentId: null, label: "crew-frame" }];
    render(
      <CanvasShell nodes={framedNodes} expanded={new Set(["crew"])} edges={edges} frames={frames} />,
    );
    expect(screen.getByText("crew-frame")).toBeTruthy();
  });
});

describe("colorLightness", () => {
  it("treats a fully transparent background as unreadable, not as black", () => {
    expect(colorLightness("rgba(0, 0, 0, 0)")).toBeNull();
  });

  it("reads an opaque light background as light", () => {
    expect(colorLightness("rgb(250, 250, 250)")).toBeGreaterThan(0.5);
  });
});

describe("CanvasShell host theme", () => {
  function renderInHost(background: string) {
    const host = document.createElement("div");
    host.style.backgroundColor = background;
    document.body.appendChild(host);
    const view = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />, { container: host });
    const flow = () => view.container.querySelector(".react-flow")!;
    return { host, flow };
  }

  afterEach(() => {
    document.documentElement.className = "";
  });

  it("follows a theme switch on the document while the canvas stays mounted", async () => {
    const { host, flow } = renderInHost("rgb(255, 255, 255)");
    expect(flow().classList.contains("light")).toBe(true);
    host.style.backgroundColor = "rgb(10, 10, 10)";
    document.documentElement.className = "dark";
    await vi.waitFor(() => expect(flow().classList.contains("dark")).toBe(true));
  });

  it("negative: an unrelated attribute change on the document does not re-measure", async () => {
    const { host, flow } = renderInHost("rgb(255, 255, 255)");
    host.style.backgroundColor = "rgb(10, 10, 10)";
    document.documentElement.setAttribute("lang", "en");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(flow().classList.contains("light")).toBe(true);
    document.documentElement.removeAttribute("lang");
  });
});
