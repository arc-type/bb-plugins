// A left-to-right tree layout: pure and DOM-free, so the same function lays
// out a preview in a test and a live canvas on screen, and can be unit tested
// without a browser.
//
// Depth becomes a column, not a row — the opposite of graph-studio's
// top-to-bottom `layoutGraph` — because the view this feeds is a navigation
// tree read left to right (agents → project → crew → member → …), not a
// flow chart. Siblings (several members, several run steps) stack as rows
// within their shared column.
import type { CanvasEdge, CanvasEdgeState, CanvasNode } from "./types";

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 64;
export const COLUMN_GAP = 96;
export const ROW_GAP = 16;
export const MARGIN = 24;
/** How far a back edge's arc bows out past the right edge of its column. */
const BACK_EDGE_LANE = 32;

export type PlacedNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
};

export type PlacedEdge = {
  from: string;
  to: string;
  variant: CanvasEdge["variant"];
  /** SVG path, ready for an `<svg><path/></svg>` or React Flow's `BaseEdge`. */
  path: string;
  label: string;
  /** A back reference bows out to the right instead of running straight down
   *  through the nodes in between. */
  isBack: boolean;
  /** Undefined draws the plain `--border` line from before BBP-146. */
  state?: CanvasEdgeState;
};

export type TreeLayout = {
  positions: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
};

/**
 * `nodes` is the full set a provider knows about; only the ones `expanded`
 * actually reveals end up in `positions` — a collapsed node's subtree is left
 * out of the layout entirely rather than placed off-screen.
 *
 * `edges` declares everything beyond the tree itself (back references,
 * messages); the parent/child line for every visible node is drawn
 * automatically and needs no entry here. An edge touching a node that is not
 * currently visible is dropped along with it.
 */
export function layoutTree(
  nodes: readonly CanvasNode[],
  expanded: ReadonlySet<string>,
  edges: readonly CanvasEdge[] = [],
): TreeLayout {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  // A parent id absent from the node set roots its node instead of vanishing
  // it or throwing — a provider that forgot one ancestor must not take the
  // rest of the tree down with it.
  const parentOf = (node: CanvasNode): string | null =>
    node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;

  const childrenOf = new Map<string | null, CanvasNode[]>();
  for (const node of nodes) {
    const key = parentOf(node);
    const list = childrenOf.get(key) ?? [];
    list.push(node);
    childrenOf.set(key, list);
  }

  const columnOf = new Map<string, number>();
  const parentIdOf = new Map<string, string | null>();
  const order: string[] = [];

  const visit = (parentId: string | null, column: number) => {
    for (const node of childrenOf.get(parentId) ?? []) {
      columnOf.set(node.id, column);
      parentIdOf.set(node.id, parentId);
      order.push(node.id);
      if (expanded.has(node.id)) visit(node.id, column + 1);
    }
  };
  visit(null, 0);

  // Every visible leaf takes the next free row; a parent sits centred on the
  // rows its open subtree spans. With 20 members under one crew the crew
  // card then sits beside the middle of its members instead of above the
  // first one, so the fan of edges stays short and symmetric.
  const visibleChildren = new Map<string, string[]>();
  for (const id of order) {
    const parentId = parentIdOf.get(id)!;
    if (parentId === null) continue;
    const list = visibleChildren.get(parentId) ?? [];
    list.push(id);
    visibleChildren.set(parentId, list);
  }
  const rowOf = new Map<string, number>();
  let nextRow = 0;
  const placeRows = (id: string): number => {
    const kids = visibleChildren.get(id) ?? [];
    if (kids.length === 0) {
      rowOf.set(id, nextRow);
      return nextRow++;
    }
    const rows = kids.map(placeRows);
    const row = (rows[0] + rows[rows.length - 1]) / 2;
    rowOf.set(id, row);
    return row;
  };
  for (const id of order) if (parentIdOf.get(id) === null) placeRows(id);

  const placed = new Map<string, PlacedNode>();
  for (const id of order) {
    const column = columnOf.get(id)!;
    placed.set(id, {
      id,
      x: MARGIN + column * (NODE_WIDTH + COLUMN_GAP),
      y: MARGIN + rowOf.get(id)! * (NODE_HEIGHT + ROW_GAP),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      column,
    });
  }

  const flowEdges: PlacedEdge[] = order.flatMap((id) => {
    const parentId = parentIdOf.get(id)!;
    if (parentId === null) return [];
    return [flowEdge(placed.get(parentId)!, placed.get(id)!, byId.get(id)!)];
  });

  const declaredEdges: PlacedEdge[] = edges.flatMap((edge) => {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) return [];
    return [edge.variant === "back" ? backEdge(from, to, edge) : messageEdge(from, to, edge)];
  });

  const maxColumn = Math.max(...[...columnOf.values()], 0);
  const maxRow = nextRow;
  const width = MARGIN * 2 + (maxColumn + 1) * NODE_WIDTH + maxColumn * COLUMN_GAP + BACK_EDGE_LANE;
  const height = MARGIN * 2 + maxRow * (NODE_HEIGHT + ROW_GAP) - (maxRow > 0 ? ROW_GAP : 0) + NODE_HEIGHT;

  return { positions: [...placed.values()], edges: [...flowEdges, ...declaredEdges], width, height };
}

/** A tree line's state follows the child it leads to, not a declared edge —
 *  there is no `CanvasEdge` for it to read one from. A child with no status
 *  was never attempted; `running` is "now"; anything else it already has a
 *  status for was attempted, so the line is "taken" (a `skipped` step counts
 *  too — it has a `nodeRuns` entry, it just was not where the run went). */
function flowEdgeState(child: CanvasNode): CanvasEdgeState | undefined {
  if (child.status === undefined) return undefined;
  return child.status === "running" ? "now" : "taken";
}

function flowEdge(from: PlacedNode, to: PlacedNode, toNode: CanvasNode): PlacedEdge {
  const fromX = from.x + from.width;
  const fromY = from.y + from.height / 2;
  const toX = to.x;
  const toY = to.y + to.height / 2;
  const midX = (fromX + toX) / 2;
  const path = [`M ${fromX} ${fromY}`, `C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`].join(" ");
  const state = flowEdgeState(toNode);
  return { from: from.id, to: to.id, variant: "flow", path, label: "", isBack: false, ...(state ? { state } : {}) };
}

/** Bows out past the right edge of the column the edge starts in, so a loop
 *  reads as a loop instead of hiding behind the nodes between its ends. */
function backEdge(from: PlacedNode, to: PlacedNode, edge: CanvasEdge): PlacedEdge {
  const laneX = Math.max(from.x, to.x) + NODE_WIDTH + BACK_EDGE_LANE;
  const fromX = from.x + from.width;
  const fromY = from.y + from.height / 2;
  const toX = to.x + to.width;
  const toY = to.y + to.height / 2;
  const path = [`M ${fromX} ${fromY}`, `C ${laneX} ${fromY}, ${laneX} ${toY}, ${toX} ${toY}`].join(" ");
  return {
    from: from.id,
    to: to.id,
    variant: "back",
    path,
    label: edge.label ?? "",
    isBack: true,
    ...(edge.state ? { state: edge.state } : {}),
  };
}

function messageEdge(from: PlacedNode, to: PlacedNode, edge: CanvasEdge): PlacedEdge {
  const fromX = from.x + from.width / 2;
  const fromY = from.y + from.height / 2;
  const toX = to.x + to.width / 2;
  const toY = to.y + to.height / 2;
  const path = `M ${fromX} ${fromY} L ${toX} ${toY}`;
  return { from: from.id, to: to.id, variant: "message", path, label: edge.label ?? "", isBack: false };
}
