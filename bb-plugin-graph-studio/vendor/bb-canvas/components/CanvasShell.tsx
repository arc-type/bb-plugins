// The React Flow hull around a `TreeLayout`: theme, zoom controls, pan and
// zoom at the pointer. No MiniMap and no keyboard here — those are the next
// work item, built on fixture data before either plugin feeds this component
// real data.
import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { NodeCard, type NodeCardProps } from "./NodeCard";
import { StatusEdge, type StatusEdgeData } from "./StatusEdge";
import type { CanvasEdge, CanvasNode } from "../lib/types";

/** React Flow's colour mode, read from the BB theme actually on screen —
 *  left at its default, React Flow paints white chrome inside a dark host. */
export function useHostColorMode(): [React.RefObject<HTMLDivElement | null>, ColorMode] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<ColorMode>("system");
  const measure = useCallback(() => {
    if (!ref.current || typeof getComputedStyle !== "function") return;
    const background = getComputedStyle(ref.current).backgroundColor;
    const lightness = colorLightness(background);
    if (lightness !== null) setMode(lightness < 0.5 ? "dark" : "light");
  }, []);
  useLayoutEffect(measure);
  return [ref, mode];
}

/** Perceived lightness (0–1) of an `rgb()`/`rgba()` string, or `null` if it
 *  cannot be read — a transparent background, for instance. */
export function colorLightness(color: string): number | null {
  const match = color.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const [r, g, b] = match[1]!.split(",").map((part) => Number(part.trim()));
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

const NODE_TYPES = { canvasNode: CanvasNodeView };
const EDGE_TYPES = { statusEdge: StatusEdge };

export type CanvasShellProps = {
  nodes: readonly CanvasNode[];
  expanded: ReadonlySet<string>;
  edges?: readonly CanvasEdge[];
  selectedId?: string | null;
  onSelect?: (nodeId: string) => void;
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
  selectedId: string | null | undefined,
  onSelect: ((id: string) => void) | undefined,
): { flowNodes: Node[]; flowEdges: Edge[] } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const flowNodes: Node[] = layout.positions.map((placed) => {
    const node = byId.get(placed.id)!;
    const data: NodeCardProps = {
      label: node.label,
      subtitle: node.kind,
      status: node.status,
      selected: node.id === selectedId,
      onClick: onSelect ? () => onSelect(node.id) : undefined,
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
    data: { variant: placed.variant, path: placed.path, label: placed.label } satisfies StatusEdgeData as unknown as Record<
      string,
      unknown
    >,
  }));

  return { flowNodes, flowEdges };
}

const CanvasShellInner = forwardRef<CanvasShellHandle, CanvasShellProps>(function CanvasShellInner(
  { nodes, expanded, edges = [], selectedId, onSelect, className },
  handleRef,
) {
  const [hostRef, colorMode] = useHostColorMode();
  const flow = useReactFlow();
  const layout = useMemo(() => layoutTree(nodes, expanded, edges), [nodes, expanded, edges]);
  const { flowNodes, flowEdges } = useMemo(
    () => toFlow(layout, nodes, selectedId, onSelect),
    [layout, nodes, selectedId, onSelect],
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
        colorMode={colorMode}
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
