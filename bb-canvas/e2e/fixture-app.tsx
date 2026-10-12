// The page a Playwright run drives: `CanvasView` alone, no plugin host, with
// a small fixed tree (a crew, three members, one running, a graph run with a
// back edge) — enough to exercise every key the acceptance criterion names.
import { createRoot } from "react-dom/client";
import { CanvasView } from "../components/CanvasView";
import type { CanvasEdge, CanvasNode } from "../lib/types";

const nodes: CanvasNode[] = [
  { id: "agents", kind: "agents", label: "Agents", parentId: null },
  { id: "project:p1", kind: "project", label: "bb-plugins", parentId: "agents" },
  { id: "crew:factory-1", kind: "crew", label: "factory-1", parentId: "project:p1" },
  { id: "member:orch-lead", kind: "member", label: "orch-lead", status: "running", parentId: "crew:factory-1" },
  { id: "member:steps-impl", kind: "member", label: "steps-impl", parentId: "crew:factory-1" },
  { id: "member:steps-review", kind: "member", label: "steps-review", parentId: "crew:factory-1" },
  { id: "graph-run:r1", kind: "graph-run", label: "review-flow #12", status: "running", parentId: "member:orch-lead" },
  { id: "step:r1:plan", kind: "step", label: "plan", status: "done", parentId: "graph-run:r1" },
  { id: "step:r1:impl", kind: "step", label: "impl", status: "running", parentId: "graph-run:r1" },
  { id: "step:r1:review", kind: "step", label: "review", parentId: "graph-run:r1" },
];

const edges: CanvasEdge[] = [{ from: "step:r1:review", to: "step:r1:plan", variant: "back", label: "retry" }];

const initialExpanded = new Set(["agents", "project:p1", "crew:factory-1"]);

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  // min(): unchanged at the default viewport, narrow when a test narrows the viewport.
  <div style={{ width: "min(1200px, 100vw)", height: "800px" }}>
    <CanvasView nodes={nodes} edges={edges} initialExpanded={initialExpanded} />
  </div>,
);
