// BBP-173/WI7: the real plugin host sometimes gives the nav-panel route a
// container with no explicit height (measured in BB) — unlike fixture-app.tsx,
// this page's outer container sets no height of its own, only `display:
// block` default flow, so the canvas must not rely on an ancestor to size it.
import { createRoot } from "react-dom/client";
import { CanvasView } from "../components/CanvasView";
import type { CanvasNode } from "../lib/types";

const nodes: CanvasNode[] = [
  { id: "crew", kind: "crew", label: "factory-1", parentId: null },
  { id: "member:lead", kind: "member", label: "orch-lead", parentId: "crew" },
];

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <div>
    <CanvasView nodes={nodes} initialExpanded={new Set(["crew"])} />
  </div>,
);
