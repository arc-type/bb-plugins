// WI2: the interactive shell around `CanvasShell` — pan/zoom at the pointer
// (CanvasShell already has that), keyboard navigation, breadcrumb, search and
// the detail sidebar. Works against whatever `nodes`/`edges` it is given —
// fixtures here, RPC data once the owning plugin wires it up (WI3/WI4).
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CanvasShell, type CanvasShellHandle } from "./CanvasShell";
import { Breadcrumb } from "./Breadcrumb";
import { Sidebar } from "./Sidebar";
import { SearchBox } from "./SearchBox";
import { ColorModeToggle, type ColorMode } from "./ColorModeToggle";
import { layoutTree } from "../lib/layout";
import type { CanvasEdge, CanvasNode } from "../lib/types";

const COLOR_MODE_KEY = "bb-canvas:colour-mode";

/** Never throws: a private-browsing tab, a full quota, or an environment
 *  with no `localStorage` at all must fall back to the default, not crash
 *  the canvas. */
function loadColorMode(): ColorMode {
  try {
    return localStorage.getItem(COLOR_MODE_KEY) === "type" ? "type" : "status";
  } catch {
    return "status";
  }
}

function saveColorMode(mode: ColorMode): void {
  try {
    localStorage.setItem(COLOR_MODE_KEY, mode);
  } catch {
    // Not persisted this time; the toggle still works for the rest of the session.
  }
}

/** What loading a node's children hands back — a thread's turns, typically. */
export type LoadedChildren = { nodes: readonly CanvasNode[]; edges?: readonly CanvasEdge[] };

export type CanvasViewProps = {
  nodes: readonly CanvasNode[];
  edges?: readonly CanvasEdge[];
  /** Expanded by default — e.g. every node up to the member level. */
  initialExpanded?: ReadonlySet<string>;
  /**
   * Loads a node's children the first time it is expanded — a thread's turns
   * from the SDK timeline, say. Called at most once per node id; its own
   * provider never needs to know this ran, since the result just joins
   * `nodes`/`edges` for layout purposes. Nodes that come with their children
   * already in `nodes` (crew, graph-run, …) need none of this.
   */
  loadChildren?: (node: CanvasNode) => Promise<LoadedChildren>;
  className?: string;
};

function parentOf(byId: Map<string, CanvasNode>, node: CanvasNode): string | null {
  return node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;
}

export function CanvasView({ nodes, edges = [], initialExpanded, loadChildren, className }: CanvasViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded ?? []));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loaded, setLoaded] = useState<ReadonlyMap<string, LoadedChildren>>(new Map());
  const [colorMode, setColorMode] = useState<ColorMode>(() => loadColorMode());
  const loading = useRef<Set<string>>(new Set());
  const shellRef = useRef<CanvasShellHandle>(null);

  function toggleColorMode() {
    setColorMode((prev) => {
      const next = prev === "status" ? "type" : "status";
      saveColorMode(next);
      return next;
    });
  }

  const allNodes = useMemo(
    () => [...nodes, ...[...loaded.values()].flatMap((result) => result.nodes)],
    [nodes, loaded],
  );
  const allEdges = useMemo(
    () => [...edges, ...[...loaded.values()].flatMap((result) => result.edges ?? [])],
    [edges, loaded],
  );

  const byId = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);
  const visible = useMemo(
    () => layoutTree(allNodes, expanded, allEdges).positions.map((placed) => byId.get(placed.id)!),
    [allNodes, expanded, allEdges, byId],
  );
  const visibleIds = useMemo(() => new Set(visible.map((node) => node.id)), [visible]);
  const hasChildren = useMemo(() => {
    const parents = new Set<string>();
    for (const node of allNodes) {
      const parent = parentOf(byId, node);
      if (parent !== null) parents.add(parent);
    }
    return parents;
  }, [allNodes, byId]);

  const selected = selectedId !== null ? (byId.get(selectedId) ?? null) : null;

  function select(id: string | null) {
    setSelectedId(id);
  }

  /** Opens a node, and — the first time, if a loader was given — fetches its
   *  children. A node with no children and no loader simply stays as it was. */
  function expand(id: string) {
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    const node = byId.get(id);
    if (!node || !loadChildren || loaded.has(id) || loading.current.has(id)) return;
    loading.current.add(id);
    void loadChildren(node).then(
      (result) => {
        loading.current.delete(id);
        setLoaded((prev) => new Map(prev).set(id, result));
      },
      () => {
        loading.current.delete(id);
      },
    );
  }

  function collapse(id: string) {
    setExpanded((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function siblingsOf(id: string): CanvasNode[] {
    const node = byId.get(id);
    if (!node) return [];
    const parent = parentOf(byId, node);
    return visible.filter((candidate) => parentOf(byId, candidate) === parent);
  }

  function moveSibling(direction: 1 | -1) {
    if (selectedId === null) {
      if (visible[0]) select(visible[0].id);
      return;
    }
    const siblings = siblingsOf(selectedId);
    const index = siblings.findIndex((node) => node.id === selectedId);
    const next = siblings[index + direction];
    if (next) select(next.id);
  }

  function moveToParent() {
    if (selectedId === null) return;
    const parent = byId.get(selectedId)?.parentId ?? null;
    if (parent !== null && visibleIds.has(parent)) select(parent);
  }

  function moveToFirstChild() {
    if (selectedId === null) return;
    const firstChild = visible.find((node) => parentOf(byId, node) === selectedId);
    if (firstChild) select(firstChild.id);
  }

  function jumpToActive() {
    const active = visible.find((node) => node.status === "running");
    if (active) select(active.id);
  }

  /** Jumps to the first visible node whose label contains `query`, and says
   *  whether it found one — `SearchBox` shows "no match" when it did not. */
  function jumpToFirstMatch(query: string): boolean {
    if (query.trim() === "") return false;
    const match = visible.find((node) => node.label.toLowerCase().includes(query.toLowerCase()));
    if (!match) return false;
    select(match.id);
    return true;
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (searchOpen) return; // SearchBox handles its own keys and stops propagation.
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveSibling(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveSibling(-1);
        break;
      case "ArrowRight":
      case "Enter":
        event.preventDefault();
        if (selectedId === null) break;
        // Always expand, even with no known children yet — a lazily loaded
        // node (a thread, before its turns arrive) looks exactly like that
        // until `loadChildren` resolves.
        expand(selectedId);
        if (event.key === "ArrowRight" && hasChildren.has(selectedId)) moveToFirstChild();
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (selectedId !== null && expanded.has(selectedId)) collapse(selectedId);
        else moveToParent();
        break;
      case "j":
      case "J":
        event.preventDefault();
        jumpToActive();
        break;
      case "0":
        event.preventDefault();
        shellRef.current?.resetView();
        break;
      case "+":
      case "=":
        event.preventDefault();
        shellRef.current?.zoomIn();
        break;
      case "-":
        event.preventDefault();
        shellRef.current?.zoomOut();
        break;
      case "/":
        event.preventDefault();
        setSearchOpen(true);
        break;
      case "Escape":
        if (selected) select(null);
        break;
      default:
        break;
    }
  }

  return (
    <div
      className={className}
      data-canvas-view
      // The container is where arrow/J/0/+-//  land; a click into the canvas
      // or the sidebar must not steal focus away from it.
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ display: "flex", flexDirection: "column", height: "100%", outline: "none" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Breadcrumb nodes={allNodes} selectedId={selectedId} onSelect={select} />
        <div style={{ padding: "4px 8px" }}>
          <ColorModeToggle mode={colorMode} onToggle={toggleColorMode} />
        </div>
      </div>
      {searchOpen ? (
        <SearchBox
          value={searchQuery}
          onChange={setSearchQuery}
          onSubmit={() => jumpToFirstMatch(searchQuery)}
          onClose={closeSearch}
        />
      ) : null}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <CanvasShell
            ref={shellRef}
            nodes={allNodes}
            expanded={expanded}
            edges={allEdges}
            selectedId={selectedId}
            onSelect={select}
            colorMode={colorMode}
          />
        </div>
        {selected ? <Sidebar node={selected} onClose={() => select(null)} /> : null}
      </div>
    </div>
  );
}
