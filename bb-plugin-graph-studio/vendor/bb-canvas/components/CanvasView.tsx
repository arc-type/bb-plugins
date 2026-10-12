// WI2: the interactive shell around `CanvasShell` — pan/zoom at the pointer
// (CanvasShell already has that), keyboard navigation, breadcrumb, search and
// the detail sidebar. Works against whatever `nodes`/`edges` it is given —
// fixtures here, RPC data once the owning plugin wires it up (WI3/WI4).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CanvasShell, type CanvasShellHandle } from "./CanvasShell";
import { Breadcrumb } from "./Breadcrumb";
import { Sidebar } from "./Sidebar";
import { SearchBox } from "./SearchBox";
import { ColorModeToggle, type ColorMode } from "./ColorModeToggle";
import { layoutTree } from "../lib/layout";
import {
  loadExpandedState,
  restoreExpanded,
  saveExpandedState,
  withToggle,
  type ExpandedState,
} from "../lib/expanded-state";
import type { CanvasEdge, CanvasFrame, CanvasNode } from "../lib/types";

const COLOR_MODE_KEY = "bb-canvas:colour-mode";
const TOOLBAR_BUTTON = {
  padding: "2px 8px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--card)",
  color: "var(--foreground)",
  fontSize: 11,
  cursor: "pointer",
} as const;
const EMPTY_DIMMED: ReadonlySet<string> = new Set();
/** Floor height so the canvas stays usable even with no sized ancestor
 *  (BBP-173). Tall enough to show a handful of cards, short enough to not
 *  force scroll in a host that does size its container normally. */
const MIN_HEIGHT = 320;

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
  frames?: readonly CanvasFrame[];
  /** Frames the current selection may enter edit mode on; a frame absent
   *  here never responds to `E` (BBP-166 negative criterion 2). */
  editableFrameIds?: ReadonlySet<string>;
  /** What to show in the side panel while a frame is being edited, in place
   *  of the generic `Sidebar` — e.g. a provider's own edit-action panel
   *  (BBP-170). Absent: edit mode simply shows no side panel. */
  renderFrameEditor?: (frameId: string) => ReactNode;
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
  /** Which nodes `loadChildren` can actually fill — those get a chevron
   *  before their children arrive; every other node without children is a
   *  leaf. Absent: any node may load, as long as a loader is given. */
  canLoadChildren?: (node: CanvasNode) => boolean;
  /** Fetches extra sidebar fields for a node the first time it is selected —
   *  a thread's provider, model, times and turn count from the SDK (BBP-179).
   *  The result is merged over the node's own `meta` for the sidebar only.
   *  Called at most once per node id; `null` or a failure leaves the node's
   *  own `meta` in place. */
  loadDetails?: (node: CanvasNode) => Promise<Record<string, unknown> | null>;
  /** Persists expand/collapse under `bb-canvas:expanded:<surface>` (BBP-183).
   *  Absent: nothing is stored, `initialExpanded` applies on every mount. */
  surface?: string;
  /** Page-owned controls shown in the toolbar beside the colour toggle —
   *  the project filter, say (BBP-181). */
  toolbar?: ReactNode;
  /** Passed straight through to the `Sidebar`'s own action buttons (BBP-185) —
   *  absent here means absent there, so no dead link ever renders. */
  onOpenThread?: (threadId: string) => void;
  onOpenRun?: (runId: string) => void;
  onOpenCrew?: (crew: string) => void;
  className?: string;
};

function parentOf(byId: Map<string, CanvasNode>, node: CanvasNode): string | null {
  return node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;
}

export function CanvasView({
  nodes,
  edges = [],
  frames = [],
  editableFrameIds,
  renderFrameEditor,
  initialExpanded,
  loadChildren,
  canLoadChildren,
  loadDetails,
  surface,
  toolbar,
  onOpenThread,
  onOpenRun,
  onOpenCrew,
  className,
}: CanvasViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    restoreExpanded(initialExpanded ?? [], surface === undefined ? null : loadExpandedState(surface)),
  );
  const persisted = useRef<ExpandedState>(
    (surface === undefined ? null : loadExpandedState(surface)) ?? { open: [], closed: [] },
  );
  const [fitRequest, setFitRequest] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<ReadonlyMap<string, Record<string, unknown>>>(() => new Map());
  const detailsRequested = useRef(new Set<string>());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loaded, setLoaded] = useState<ReadonlyMap<string, LoadedChildren>>(new Map());
  // BBP-179: a thread whose `loadChildren` rejected — cleared the moment a
  // retry (clicking the card again) resolves, so the error never outlives
  // the state that caused it.
  const [failedLoads, setFailedLoads] = useState<ReadonlySet<string>>(new Set());
  const [colorMode, setColorMode] = useState<ColorMode>(() => loadColorMode());
  // Only one frame editable at a time (BBP-166): entering a second frame's
  // edit mode without an `Escape` first is a no-op, not a silent switch.
  const [editingFrameId, setEditingFrameId] = useState<string | null>(null);
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

  /** Cards that can open: known children, or a loader that has not run yet
   *  for them. A load that came back empty turns the card into a leaf. */
  const expandable = useMemo(() => {
    const ids = new Set(hasChildren);
    if (loadChildren) {
      for (const node of allNodes) {
        if (loaded.has(node.id) || ids.has(node.id)) continue;
        if (canLoadChildren ? canLoadChildren(node) : true) ids.add(node.id);
      }
    }
    return ids;
  }, [hasChildren, allNodes, loaded, loadChildren, canLoadChildren]);

  // A restored or initially open lazy card has to fetch its children too —
  // `expand` only covers the ones opened during this session.
  useEffect(() => {
    for (const id of expanded) if (!hasChildren.has(id)) startLoad(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  function remember(next: ExpandedState) {
    persisted.current = next;
    if (surface !== undefined) saveExpandedState(surface, next);
  }

  const selected = selectedId !== null ? (byId.get(selectedId) ?? null) : null;
  const selectedDetails = selected ? details.get(selected.id) : undefined;
  const sidebarNode = useMemo(
    () => (selected && selectedDetails ? { ...selected, meta: { ...selected.meta, ...selectedDetails } } : selected),
    [selected, selectedDetails],
  );

  useEffect(() => {
    if (!selected || !loadDetails || detailsRequested.current.has(selected.id)) return;
    const id = selected.id;
    detailsRequested.current.add(id);
    void loadDetails(selected).then(
      (loadedDetails) => {
        if (loadedDetails) setDetails((previous) => new Map(previous).set(id, loadedDetails));
      },
      () => {
        // The sidebar keeps the node's own meta; a reselect does not retry,
        // so a dead endpoint is not hammered on every click.
      },
    );
  }, [selected, loadDetails]);

  const dimmedIds = useMemo(() => {
    if (editingFrameId === null) return EMPTY_DIMMED;
    const ids = new Set<string>();
    for (const node of visible) if (node.frameId !== editingFrameId) ids.add(node.id);
    for (const frame of frames) if (frame.id !== editingFrameId) ids.add(frame.id);
    return ids;
  }, [editingFrameId, visible, frames]);

  // Edit mode forces "type" so the edited layer's own kinds read clearly,
  // without touching the user's saved status/type preference — `Escape`
  // hands control straight back to `colorMode` below.
  const effectiveColorMode = editingFrameId !== null ? "type" : colorMode;

  function enterEditMode() {
    if (editingFrameId !== null) return; // nested edit attempt: ignored, not switched.
    if (selectedId === null) return;
    const frameId = byId.get(selectedId)?.frameId;
    if (frameId === undefined || !editableFrameIds?.has(frameId)) return;
    setEditingFrameId(frameId);
  }

  function exitEditMode(): boolean {
    if (editingFrameId === null) return false;
    setEditingFrameId(null);
    return true;
  }

  function select(id: string | null) {
    setSelectedId(id);
  }

  /** Opens a node, and — the first time, if a loader was given — fetches its
   *  children. A leaf (no children, nothing to load) stays as it was. */
  function expand(id: string) {
    if (!expandable.has(id)) return;
    remember(withToggle(persisted.current, id, true));
    setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    startLoad(id);
  }

  function startLoad(id: string) {
    const node = byId.get(id);
    if (node && canLoadChildren && !canLoadChildren(node)) return;
    if (!node || !loadChildren || loaded.has(id) || loading.current.has(id)) return;
    loading.current.add(id);
    void loadChildren(node).then(
      (result) => {
        loading.current.delete(id);
        setLoaded((prev) => new Map(prev).set(id, result));
        setFailedLoads((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      },
      (error: unknown) => {
        loading.current.delete(id);
        // BBP-179: a rejected load used to vanish — the card just stayed
        // empty, indistinguishable from "this thread genuinely has no
        // turns". Surfacing it here, and as a visible error on the card
        // itself (NodeCard's `loadFailed`), makes a real failure
        // diagnosable instead of silently uncountable.
        console.error(`bb-canvas: failed to load children for node "${id}"`, error);
        setFailedLoads((prev) => new Set(prev).add(id));
      },
    );
  }

  function collapse(id: string) {
    remember(withToggle(persisted.current, id, false));
    setExpanded((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function toggle(id: string) {
    // A failed load already left the node "expanded" with nothing to show;
    // toggling it again must retry, not collapse it right back to looking
    // like a leaf with no error.
    if (failedLoads.has(id)) {
      startLoad(id);
      return;
    }
    if (expanded.has(id)) collapse(id);
    else expand(id);
  }

  /** Only cards whose children are already known: a lazy card stays shut,
   *  so this never fires a burst of timeline fetches. */
  function expandAll() {
    const ids = [...hasChildren];
    remember({ open: ids, closed: [] });
    setExpanded(new Set(ids));
    setFitRequest((count) => count + 1);
  }

  function collapseAll() {
    remember({ open: [], closed: [...new Set([...expandable, ...expanded])] });
    setExpanded(new Set());
    setFitRequest((count) => count + 1);
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
        event.preventDefault();
        if (selectedId === null) break;
        // The tree-view pattern: a closed card opens, an open one steps
        // into its first child.
        if (!expanded.has(selectedId)) expand(selectedId);
        else moveToFirstChild();
        break;
      case "Enter":
        event.preventDefault();
        if (selectedId !== null && expandable.has(selectedId)) toggle(selectedId);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (selectedId !== null && expanded.has(selectedId) && expandable.has(selectedId)) collapse(selectedId);
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
      case "e":
      case "E":
        event.preventDefault();
        enterEditMode();
        break;
      case "Escape":
        // Leaving edit mode wins over the plain deselect below — with both
        // active, one Escape must not do both at once.
        if (exitEditMode()) break;
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
      // `height: "100%"` alone collapses to 0 the moment an ancestor has no
      // explicit height of its own — the nav-panel route's container, for
      // one (BBP-173). `minHeight` is the floor that keeps the canvas usable
      // either way; a sized ancestor still wins, since 100% there is taller.
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: MIN_HEIGHT, outline: "none" }}
    >
      {/* Wraps rather than overflows: in BB's slim panel (370px) the
          controls would otherwise run past the right edge (BBP-179). */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Breadcrumb nodes={allNodes} selectedId={selectedId} onSelect={select} />
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "4px 8px" }}>
          {toolbar}
          <button type="button" onClick={collapseAll} style={TOOLBAR_BUTTON}>
            Collapse all
          </button>
          <button type="button" onClick={expandAll} style={TOOLBAR_BUTTON}>
            Expand all
          </button>
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
            expandable={expandable}
            onToggle={toggle}
            fitRequest={fitRequest}
            edges={allEdges}
            frames={frames}
            selectedId={selectedId}
            onSelect={select}
            colorMode={effectiveColorMode}
            dimmedIds={dimmedIds}
            failedLoads={failedLoads}
          />
        </div>
        {editingFrameId !== null
          ? (renderFrameEditor?.(editingFrameId) ?? null)
          : selected
            ? (
                <Sidebar
                  node={sidebarNode ?? selected}
                  onClose={() => select(null)}
                  onOpenThread={onOpenThread}
                  onOpenRun={onOpenRun}
                  onOpenCrew={onOpenCrew}
                />
              )
            : null}
      </div>
    </div>
  );
}
