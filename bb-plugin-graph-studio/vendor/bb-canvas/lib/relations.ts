// Relation edges (BBP-202): a crew's declared links, drawn on demand. Hidden
// unless the "Relations" toggle is on; a selected node always shows its own,
// highlighted — with the toggle on, the rest stay but dim.
import type { CanvasEdge } from "./types";

export const relationsStorageKey = (surface: string): string => `bb-canvas:relations:${surface}`;

export function relationsView(
  edges: readonly CanvasEdge[],
  showRelations: boolean,
  selectedId: string | null,
): CanvasEdge[] {
  const touches = (edge: CanvasEdge) => edge.relation === true && (edge.from === selectedId || edge.to === selectedId);
  const focused = selectedId !== null && edges.some(touches);
  return edges.flatMap((edge) => {
    if (!edge.relation) return [edge];
    if (!focused) return showRelations ? [edge] : [];
    if (touches(edge)) return [{ ...edge, emphasis: "highlight" as const }];
    return showRelations ? [{ ...edge, emphasis: "dim" as const }] : [];
  });
}

/** Off unless stored as on; never throws (see `loadExpandedState`). */
export function loadRelations(surface: string | undefined): boolean {
  if (surface === undefined) return false;
  try {
    return localStorage.getItem(relationsStorageKey(surface)) === "on";
  } catch {
    return false;
  }
}

export function saveRelations(surface: string | undefined, on: boolean): void {
  if (surface === undefined) return;
  try {
    localStorage.setItem(relationsStorageKey(surface), on ? "on" : "off");
  } catch {
    // Not persisted this time; the toggle still works for the session.
  }
}
