// The React Flow hull around a `TreeLayout`: theme, zoom controls, pan and
// zoom at the pointer. No MiniMap and no keyboard here — those are the next
// work item, built on fixture data before either plugin feeds this component
// real data.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type ColorMode,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutTree, type TreeLayout } from "../lib/layout";
import { NodeCard, type NodeCardColorMode, type NodeCardProps } from "./NodeCard";
import { Frame, type FrameProps } from "./Frame";
import { describeNode, KindIcon } from "./KindIcon";
import { StatusEdge, type StatusEdgeData } from "./StatusEdge";
import type { CanvasEdge, CanvasFrame, CanvasNode } from "../lib/types";

/** React Flow's colour mode, read from the BB theme actually on screen —
 *  left at its default, React Flow paints white chrome inside a dark host. */
export function useHostColorMode(): [React.RefObject<HTMLDivElement | null>, ColorMode] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<ColorMode>("system");
  const measure = useCallback(() => {
    if (!ref.current || typeof getComputedStyle !== "function") return;
    // The shell itself is transparent, and `rgba(0, 0, 0, 0)` would read as
    // black: walk up to the first painted background, the one actually on
    // screen behind the canvas.
    for (let element: Element | null = ref.current; element; element = element.parentElement) {
      const lightness = colorLightness(getComputedStyle(element).backgroundColor);
      if (lightness === null) continue;
      setMode(lightness < 0.5 ? "dark" : "light");
      return;
    }
  }, []);
  useLayoutEffect(measure);
  // A theme switch repaints the host without re-rendering the canvas, so
  // measuring on render alone keeps the old mode until something else
  // happens to re-render it.
  useEffect(() => {
    if (typeof MutationObserver !== "function") return;
    const observer = new MutationObserver(measure);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    media?.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      media?.removeEventListener("change", measure);
    };
  }, [measure]);
  return [ref, mode];
}

/** Perceived lightness (0–1) of an `rgb()`/`rgba()` string, or `null` if it
 *  cannot be read or is fully transparent. */
export function colorLightness(color: string): number | null {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const [r, g, b, alpha] = match[1]!.split(",").map((part) => Number(part.trim()));
  if (alpha === 0) return null;
  if (r === undefined || g === undefined || b === undefined || [r, g, b].some(Number.isNaN)) return null;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** A tree grows left to right, so a node's one incoming edge arrives on its
 *  left and its outgoing edges leave from its right — without a handle on
 *  each side, React Flow has nowhere to anchor the path and draws no edge
 *  at all (its own connection points default to top/bottom). */
function CanvasNodeView({ data }: { data: NodeCardProps }) {
  return (
    <>
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      <NodeCard {...data} />
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
    </>
  );
}

/** `width`/`height` arrive via the node's own `style`, not `data` — React
 *  Flow positions the wrapper, `Frame` just fills it. */
function CanvasFrameView({
  data,
  style,
}: {
  data: Pick<FrameProps, "label" | "dimmed">;
  style?: { width?: number; height?: number };
}) {
  return (
    <Frame
      label={data.label}
      dimmed={data.dimmed}
      x={0}
      y={0}
      width={style?.width ?? 0}
      height={style?.height ?? 0}
    />
  );
}

const NODE_TYPES = { canvasNode: CanvasNodeView, canvasFrame: CanvasFrameView };
const EDGE_TYPES = { statusEdge: StatusEdge };
const EMPTY_DIMMED: ReadonlySet<string> = new Set();

export type CanvasShellProps = {
  nodes: readonly CanvasNode[];
  expanded: ReadonlySet<string>;
  /** Cards that get a chevron (BBP-183); absent: none do. */
  expandable?: ReadonlySet<string>;
  onToggle?: (nodeId: string) => void;
  edges?: readonly CanvasEdge[];
  frames?: readonly CanvasFrame[];
  selectedId?: string | null;
  onSelect?: (nodeId: string) => void;
  /** Node and frame ids outside the frame being edited (BBP-166) — faded,
   *  locked, no `onSelect`. */
  dimmedIds?: ReadonlySet<string>;
  /** "status" (default) borders a card by its run state; "type" tints a
   *  neutral card by `kind` instead. An error or needs-input border always
   *  wins over either. */
  colorMode?: NodeCardColorMode;
  /** Nodes whose lazy load failed (BBP-179) — shown as a visible error on
   *  the card instead of an empty one, and retried on the next toggle. */
  failedLoads?: ReadonlySet<string>;
  className?: string;
};

/** What a caller outside the `ReactFlowProvider` can still do to the
 *  viewport — the `0`/`+`/`-` keys in particular, owned by `CanvasView`. */
export type CanvasShellHandle = {
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

function toFlow(
  layout: TreeLayout,
  nodes: readonly CanvasNode[],
  frames: readonly CanvasFrame[],
  selectedId: string | null | undefined,
  onSelect: ((id: string) => void) | undefined,
  colorMode: NodeCardColorMode,
  dimmedIds: ReadonlySet<string>,
  expanded: ReadonlySet<string>,
  expandable: ReadonlySet<string>,
  onToggle: ((id: string) => void) | undefined,
  failedLoads: ReadonlySet<string>,
): { flowNodes: Node[]; flowEdges: Edge[] } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byFrameId = new Map(frames.map((frame) => [frame.id, frame]));
  const childCount = new Map<string, number>();
  for (const node of nodes) {
    if (node.parentId !== null) childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
  }
  const flowNodes: Node[] = layout.positions.map((placed) => {
    const node = byId.get(placed.id)!;
    const data: NodeCardProps = {
      label: node.label,
      subtitle: describeNode(node.kind, childCount.get(node.id) ?? 0, node.meta),
      icon: <KindIcon kind={node.kind} />,
      status: node.status,
      kind: node.kind,
      colorMode,
      selected: node.id === selectedId,
      onClick: onSelect ? () => onSelect(node.id) : undefined,
      dimmed: dimmedIds.has(node.id),
      loadFailed: failedLoads.has(node.id),
      expander: expandable.has(node.id)
        ? {
            expanded: expanded.has(node.id),
            childCount: childCount.get(node.id) ?? 0,
            onToggle: () => onToggle?.(node.id),
          }
        : undefined,
    };
    return {
      id: placed.id,
      type: "canvasNode",
      position: { x: placed.x, y: placed.y },
      // Both the style (what paints) and `width`/`height` (what React Flow
      // treats as already measured): without the latter a node stays
      // `visibility: hidden` until its own ResizeObserver fires, which never
      // happens in a DOM that only stubs the observer.
      style: { width: placed.width, height: placed.height },
      width: placed.width,
      height: placed.height,
      data: data as unknown as Record<string, unknown>,
      draggable: false,
      selectable: false,
    };
  });

  const flowEdges: Edge[] = layout.edges.map((placed, index) => ({
    id: `${placed.from}->${placed.to}-${index}`,
    source: placed.from,
    target: placed.to,
    type: "statusEdge",
    data: {
      variant: placed.variant,
      path: placed.path,
      label: placed.label,
      state: placed.state,
    } satisfies StatusEdgeData as unknown as Record<string, unknown>,
  }));

  const frameNodes: Node[] = (layout.frames ?? []).map((placed) => ({
    id: placed.id,
    type: "canvasFrame",
    position: { x: placed.x, y: placed.y },
    style: { width: placed.width, height: placed.height },
    width: placed.width,
    height: placed.height,
    data: {
      label: byFrameId.get(placed.id)?.label,
      dimmed: dimmedIds.has(placed.id),
    } as unknown as Record<string, unknown>,
    draggable: false,
    selectable: false,
    // Below every card: React Flow stacks nodes in array order by default.
    zIndex: 0,
  }));

  return { flowNodes: [...frameNodes, ...flowNodes], flowEdges };
}

const CanvasShellInner = forwardRef<CanvasShellHandle, CanvasShellProps>(function CanvasShellInner(
  {
    nodes,
    expanded,
    expandable = EMPTY_DIMMED,
    onToggle,
    edges = [],
    frames = [],
    selectedId,
    onSelect,
    colorMode: cardColorMode = "status",
    dimmedIds = EMPTY_DIMMED,
    failedLoads = EMPTY_DIMMED,
    className,
  },
  handleRef,
) {
  const [hostRef, themeMode] = useHostColorMode();
  const flow = useReactFlow();
  const layout = useMemo(() => layoutTree(nodes, expanded, edges, frames), [nodes, expanded, edges, frames]);
  const { flowNodes, flowEdges } = useMemo(
    () =>
      toFlow(layout, nodes, frames, selectedId, onSelect, cardColorMode, dimmedIds, expanded, expandable, onToggle, failedLoads),
    [layout, nodes, frames, selectedId, onSelect, cardColorMode, dimmedIds, expanded, expandable, onToggle, failedLoads],
  );

  useImperativeHandle(
    handleRef,
    () => ({
      resetView: () => flow.fitView(),
      zoomIn: () => flow.zoomIn(),
      zoomOut: () => flow.zoomOut(),
    }),
    [flow],
  );

  return (
    <div ref={hostRef} className={className} style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        colorMode={themeMode}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        // React Flow's own keyboard a11y moves a focused node with the
        // arrow keys and deletes it with Delete — exactly the keys
        // `CanvasView` already gives a meaning to. Without this, a click on a
        // card (which focuses its node) hands those keys to React Flow first.
        disableKeyboardA11y
        zoomOnScroll
        panOnScroll={false}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        // React Flow's default floor (0.5) is too high for a real tree: two
        // crews with ten members each no longer fit, so the start view and
        // `0` cut off the top instead of showing the whole tree.
        minZoom={0.2}
        // The canvas is a page of its own inside BB, not a demo; the corner
        // badge would be the only non-BB text on it.
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
});

export const CanvasShell = forwardRef<CanvasShellHandle, CanvasShellProps>(function CanvasShell(props, ref) {
  // Its own provider: two shells on one page (a preview and the full canvas)
  // must not share a viewport.
  return (
    <ReactFlowProvider>
      <CanvasShellInner {...props} ref={ref} />
    </ReactFlowProvider>
  );
});
