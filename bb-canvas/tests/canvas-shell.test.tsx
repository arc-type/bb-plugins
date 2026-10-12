// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";

// BBP-196 fix: the start fit must keep chasing the tree across async growth
// (restored filter + restored expanded threads/turns each arrive over
// several `loadChildren` round-trips), not just fit once against whatever
// React Flow's store happened to hold first. `fitView` itself cannot be
// observed through the DOM in jsdom (the container always measures 0x0
// here), so this wraps the real `useReactFlow` to record every `fitView`
// call instead.
const fitViewCalls: unknown[] = [];
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useReactFlow: () => {
      const real = actual.useReactFlow();
      return {
        ...real,
        fitView: (options?: unknown) => {
          fitViewCalls.push(options);
          return real.fitView(options as never);
        },
      };
    },
  };
});

const { CanvasShell, colorLightness, START_MIN_ZOOM, startFitOptions } = await import("@/components/CanvasShell");
const { CanvasView } = await import("@/components/CanvasView");
type CanvasEdge = import("@/lib/types").CanvasEdge;
type CanvasFrame = import("@/lib/types").CanvasFrame;
type CanvasNode = import("@/lib/types").CanvasNode;
type CanvasShellHandle = import("@/components/CanvasShell").CanvasShellHandle;

afterEach(() => {
  cleanup();
  fitViewCalls.length = 0;
});

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

describe("CanvasShell trackpad/scroll navigation (BBP-199)", () => {
  function viewportTransform(container: HTMLElement): string {
    return (container.querySelector(".react-flow__viewport") as HTMLElement).style.transform;
  }

  it("pans the viewport on a plain wheel gesture over the canvas", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const pane = container.querySelector(".react-flow__pane")!;
    const before = viewportTransform(container);
    fireEvent.wheel(pane, { deltaX: 0, deltaY: 100, bubbles: true });
    const after = viewportTransform(container);
    expect(after).not.toBe(before);
    // A pan changes translate, not scale.
    expect(after.match(/scale\(([^)]+)\)/)?.[1]).toBe(before.match(/scale\(([^)]+)\)/)?.[1]);
  });

  it("zooms at the pointer on Ctrl+wheel instead of panning", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const pane = container.querySelector(".react-flow__pane")!;
    const before = viewportTransform(container);
    fireEvent.wheel(pane, { deltaX: 0, deltaY: -100, ctrlKey: true, bubbles: true });
    const after = viewportTransform(container);
    expect(after.match(/scale\(([^)]+)\)/)?.[1]).not.toBe(before.match(/scale\(([^)]+)\)/)?.[1]);
  });

  it("negative: a wheel gesture over a node card without Ctrl/Cmd pans instead of zooming", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const card = screen.getByRole("button", { name: new RegExp("^orch-lead — ") });
    const before = viewportTransform(container);
    fireEvent.wheel(card, { deltaX: 0, deltaY: 100, bubbles: true });
    const after = viewportTransform(container);
    expect(after.match(/scale\(([^)]+)\)/)?.[1]).toBe(before.match(/scale\(([^)]+)\)/)?.[1]);
  });

  it("negative: scrolling over an element outside the canvas pane does not move the viewport", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const outside = document.createElement("div");
    outside.className = "nowheel";
    container.appendChild(outside);
    const before = viewportTransform(container);
    fireEvent.wheel(outside, { deltaX: 0, deltaY: 100, bubbles: true });
    expect(viewportTransform(container)).toBe(before);
  });
});

describe("CanvasShell Ctrl/Cmd zoom at pointer, gentle step (BBP-197 Fix 3)", () => {
  function viewport(container: HTMLElement): { x: number; y: number; scale: number } {
    const transform = (container.querySelector(".react-flow__viewport") as HTMLElement).style.transform;
    const translate = transform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/)!;
    const scale = transform.match(/scale\(([^)]+)\)/)!;
    return { x: Number(translate[1]), y: Number(translate[2]), scale: Number(scale[1]) };
  }

  // The library's own Ctrl+wheel pinch path multiplies the zoom step by 10
  // only when `navigator.userAgent` contains "Mac" (its `isMacOs()` check) —
  // the 4x-per-notch bug the Concierge measured only reproduces there.
  const realUserAgent = navigator.userAgent;
  beforeEach(() => {
    Object.defineProperty(navigator, "userAgent", { value: "Macintosh", configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", { value: realUserAgent, configurable: true });
  });

  it("zooms on Cmd(Meta)+wheel, not just Ctrl+wheel", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const pane = container.querySelector(".react-flow__pane")!;
    const before = viewport(container);
    fireEvent.wheel(pane, { deltaX: 0, deltaY: -100, metaKey: true, clientX: 100, clientY: 50, bubbles: true });
    const after = viewport(container);
    expect(after.scale).not.toBe(before.scale);
  });

  it("keeps the flow point under the pointer fixed across a Ctrl+wheel zoom", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const pane = container.querySelector(".react-flow__pane")!;
    const pointer = { clientX: 120, clientY: 80 };
    const before = viewport(container);
    const flowPointBefore = {
      x: (pointer.clientX - before.x) / before.scale,
      y: (pointer.clientY - before.y) / before.scale,
    };
    fireEvent.wheel(pane, { deltaX: 0, deltaY: -100, ctrlKey: true, ...pointer, bubbles: true });
    const after = viewport(container);
    const flowPointAfter = {
      x: (pointer.clientX - after.x) / after.scale,
      y: (pointer.clientY - after.y) / after.scale,
    };
    expect(flowPointAfter.x).toBeCloseTo(flowPointBefore.x, 5);
    expect(flowPointAfter.y).toBeCloseTo(flowPointBefore.y, 5);
  });

  it("negative: a single wheel notch is a gentle step, not a 4x jump", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const pane = container.querySelector(".react-flow__pane")!;
    const before = viewport(container);
    fireEvent.wheel(pane, { deltaX: 0, deltaY: 100, ctrlKey: true, clientX: 100, clientY: 50, bubbles: true });
    const after = viewport(container);
    const ratio = after.scale / before.scale;
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1);
  });

  it("scales a tiny trackpad-pinch delta smoothly, proportional to deltaY", () => {
    const { container } = render(<CanvasShell nodes={nodes} expanded={new Set(["crew"])} edges={edges} />);
    const pane = container.querySelector(".react-flow__pane")!;
    const before = viewport(container);
    fireEvent.wheel(pane, { deltaX: 0, deltaY: -5, ctrlKey: true, clientX: 100, clientY: 50, bubbles: true });
    const after = viewport(container);
    const ratio = after.scale / before.scale;
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(1.05);
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

describe("startFitOptions (BBP-196)", () => {
  const tree: CanvasNode[] = [
    { id: "root", kind: "agents", label: "bb", parentId: null },
    { id: "p1", kind: "project", label: "p1", parentId: "root" },
    { id: "p2", kind: "project", label: "p2", parentId: "root" },
    { id: "t1", kind: "thread", label: "t1", parentId: "p1" },
    { id: "orphan", kind: "thread", label: "orphan", parentId: "missing" },
  ];

  it("fits only the roots and their direct children", () => {
    const ids = startFitOptions(tree).nodes.map((n) => n.id);
    expect(ids.sort()).toEqual(["orphan", "p1", "p2", "root"]);
  });

  it("floors the zoom at a readable minimum, above the manual floor of 0.2", () => {
    const options = startFitOptions(tree);
    expect(options.minZoom).toBe(START_MIN_ZOOM);
    expect(START_MIN_ZOOM).toBeGreaterThan(0.2);
  });

  it("sets no fixed zoom: a small tree still fits larger than the floor", () => {
    const options = startFitOptions(tree) as Record<string, unknown>;
    expect(options.maxZoom).toBeUndefined();
  });
});

// BBP-196 fix: a restored project filter plus restored expanded threads/turns
// means the tree keeps growing for a while after mount — each `loadChildren`
// resolution re-centers the layout (a parent sits centered on its children).
// Regression for: the start view ended up empty because React Flow's own
// `fitView` prop fit once, against the small initial tree, and never
// refitted once the restored children arrived.
describe("CanvasShell start-view refit across async growth (BBP-196)", () => {
  const baseNodes: CanvasNode[] = [
    { id: "root", kind: "agents", label: "bb", parentId: null },
    { id: "project", kind: "project", label: "bb-plugins", parentId: "root" },
    { id: "member", kind: "member", label: "a", parentId: "project" },
    { id: "thread", kind: "thread", label: "Thread", parentId: "member", meta: { threadId: "t1" } },
  ];

  it("refits the start view once a restored thread's children arrive asynchronously", async () => {
    let resolveLoad!: (value: { nodes: CanvasNode[] }) => void;
    const loadChildren = () => new Promise<{ nodes: CanvasNode[] }>((resolve) => (resolveLoad = resolve));

    render(
      <CanvasView
        nodes={baseNodes}
        // A thread already expanded from a restored (persisted) state, like
        // `localStorage` replaying a prior session's open nodes.
        initialExpanded={new Set(["root", "project", "member", "thread"])}
        loadChildren={loadChildren}
        canLoadChildren={(node) => node.kind === "thread"}
      />,
    );

    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(0));
    const callsBeforeLoad = fitViewCalls.length;

    resolveLoad({
      nodes: [{ id: "turn-1", kind: "turn", label: "Turn · 1 step", parentId: "thread" }],
    });

    // The restored thread's turn lands after mount — the start view must
    // chase it with another fit, not leave the camera on the pre-load tree.
    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(callsBeforeLoad));
  });

  it("stops refitting once the user has taken the viewport into their own hands", async () => {
    const ref = createRef<CanvasShellHandle>();
    const { rerender } = render(
      <CanvasShell ref={ref} nodes={baseNodes} expanded={new Set(["root", "project", "member"])} />,
    );
    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(0));

    ref.current!.zoomIn();
    const callsAfterInteraction = fitViewCalls.length;

    // More nodes arrive later (e.g. the user expands something else by
    // hand) — the start view must not yank a now-manually-positioned camera
    // back to the "first level" framing.
    rerender(
      <CanvasShell
        ref={ref}
        nodes={[...baseNodes, { id: "thread", kind: "thread", label: "Thread", parentId: "member" }]}
        expanded={new Set(["root", "project", "member", "thread"])}
      />,
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(fitViewCalls.length).toBe(callsAfterInteraction);
  });

  it("stops refitting after a Ctrl/Cmd+wheel zoom too, not just the zoomIn/zoomOut/resetView handle (BBP-197 Fix 3 x BBP-196)", async () => {
    const { container, rerender } = render(
      <CanvasShell nodes={baseNodes} expanded={new Set(["root", "project", "member"])} />,
    );
    await waitFor(() => expect(fitViewCalls.length).toBeGreaterThan(0));
    const pane = container.querySelector(".react-flow__pane")!;
    fireEvent.wheel(pane, { deltaX: 0, deltaY: -100, ctrlKey: true, clientX: 100, clientY: 50, bubbles: true });
    const callsAfterZoom = fitViewCalls.length;

    // Our own `onWheelCapture` zoom calls `flow.setViewport` directly, not a
    // gesture React Flow's `onMoveStart` observes — the start-fit effect
    // must still learn this counts as user interaction, or a later nodes
    // change refits the view right back out from under the zoom.
    rerender(
      <CanvasShell
        nodes={[...baseNodes, { id: "thread", kind: "thread", label: "Thread", parentId: "member" }]}
        expanded={new Set(["root", "project", "member", "thread"])}
      />,
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(fitViewCalls.length).toBe(callsAfterZoom);
  });
});
