// WI2: the interactive shell around `CanvasShell` — pan/zoom at the pointer
// (CanvasShell already has that), keyboard navigation, breadcrumb, search and
// the detail sidebar. Works against whatever `nodes`/`edges` it is given —
// fixtures here, RPC data once the owning plugin wires it up (WI3/WI4).
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CanvasShell, type CanvasShellHandle } from "@/components/CanvasShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Sidebar } from "@/components/Sidebar";
import { SearchBox } from "@/components/SearchBox";
import { layoutTree } from "@/lib/layout";
import type { CanvasEdge, CanvasNode } from "@/lib/types";

export type CanvasViewProps = {
  nodes: readonly CanvasNode[];
  edges?: readonly CanvasEdge[];
  /** Expanded by default — e.g. every node up to the member level. */
  initialExpanded?: ReadonlySet<string>;
  className?: string;
};

function parentOf(byId: Map<string, CanvasNode>, node: CanvasNode): string | null {
  return node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;
}

export function CanvasView({ nodes, edges = [], initialExpanded, className }: CanvasViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded ?? []));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const shellRef = useRef<CanvasShellHandle>(null);

  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const visible = useMemo(
    () => layoutTree(nodes, expanded, edges).positions.map((placed) => byId.get(placed.id)!),
    [nodes, expanded, edges, byId],
  );
  const visibleIds = useMemo(() => new Set(visible.map((node) => node.id)), [visible]);
  const hasChildren = useMemo(() => {
    const parents = new Set<string>();
    for (const node of nodes) {
      const parent = parentOf(byId, node);
      if (parent !== null) parents.add(parent);
    }
    return parents;
  }, [nodes, byId]);

  const selected = selectedId !== null ? (byId.get(selectedId) ?? null) : null;

  function select(id: string | null) {
    setSelectedId(id);
  }

  function expand(id: string) {
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
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
        if (selectedId !== null && hasChildren.has(selectedId)) expand(selectedId);
        else if (event.key === "ArrowRight") moveToFirstChild();
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
      <Breadcrumb nodes={nodes} selectedId={selectedId} onSelect={select} />
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
            nodes={nodes}
            expanded={expanded}
            edges={edges}
            selectedId={selectedId}
            onSelect={select}
          />
        </div>
        {selected ? <Sidebar node={selected} onClose={() => select(null)} /> : null}
      </div>
    </div>
  );
}
