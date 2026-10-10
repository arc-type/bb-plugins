// Dragging a thread card, on pointer events instead of HTML5 drag.
//
// The card also carries the host's split props: their `onPointerDown` arms the
// host's drag-into-a-split, and that blocks every native `dragstart` on the
// window until the pointer is up (BBP-136). So the card cannot use `draggable`.
// Instead, aside follows the pointer itself while it stays in the sidebar; once
// the pointer leaves it to the right, the host engages its split drag and sends
// Escape — which cancels ours. One gesture, two outcomes, no conflict.
import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import type { DropWhere } from "@/components/sidenav/thread-card";

/** The list below, or the pinned group at the top: a drag stays in its own. */
export type ThreadDragGroup = "list" | "pinned";

export type ThreadDropTarget =
  | { kind: "card"; id: string; group: ThreadDragGroup; where: DropWhere }
  | { kind: "section"; id: string };

/** Pixels the pointer travels before a press becomes a drag. */
const ENGAGE_DISTANCE = 4;

/** The upper half drops before, the lower half after. A drag never nests:
 *  that turned an accidental drop into a sub-thread you could not drag out. */
export function dropWhereAt(share: number): DropWhere {
  return share < 0.5 ? "before" : "after";
}

/** The drop target under a point, read from the rows' data attributes. */
export function targetAt(
  element: Element | null,
  clientY: number,
  draggedId: string,
  group: ThreadDragGroup = "list",
): ThreadDropTarget | null {
  const card = element?.closest<HTMLElement>("[data-aside-card]");
  const cardId = card?.dataset.asideCard;
  if (card && cardId) {
    // A pin shows up twice — in the group and in its project. Only the copy in
    // the dragged card's own group is a target.
    if (cardId === draggedId || (card.dataset.asideGroup ?? "list") !== group) return null;
    const bounds = card.getBoundingClientRect();
    const share = (clientY - bounds.top) / bounds.height;
    return { kind: "card", id: cardId, group, where: dropWhereAt(share) };
  }
  if (group === "pinned") return null;
  const sectionId = element?.closest<HTMLElement>("[data-aside-section]")?.dataset.asideSection;
  return sectionId ? { kind: "section", id: sectionId } : null;
}

let target: ThreadDropTarget | null = null;
let justDragged = false;
const listeners = new Set<() => void>();

function setTarget(next: ThreadDropTarget | null) {
  if (
    next?.kind === target?.kind &&
    next?.id === target?.id &&
    (next?.kind !== "card" || target?.kind !== "card" || next.group === target.group) &&
    (next?.kind !== "card" || target?.kind !== "card" || next.where === target.where)
  ) {
    return;
  }
  target = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Where a drag would land on this card, or `null`. */
export function useCardDropWhere(cardId: string, group: ThreadDragGroup): DropWhere | null {
  return useSyncExternalStore(subscribe, () =>
    target?.kind === "card" && target.id === cardId && target.group === group
      ? target.where
      : null,
  );
}

/** Whether a dragged thread hovers this section row. */
export function useSectionDropActive(sectionId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => target?.kind === "section" && target.id === sectionId,
  );
}

/** A drag ends with a click; the card asks this so it does not open. */
export function consumeDragClick(): boolean {
  return justDragged;
}

/**
 * Section rows sit outside the card, so their drop callback is looked up by id
 * at drop time rather than threaded through every card.
 */
const sectionDrops = new Map<string, (threadId: string) => void>();

export function registerSectionDrop(sectionId: string, onDrop: (threadId: string) => void) {
  sectionDrops.set(sectionId, onDrop);
  return () => {
    if (sectionDrops.get(sectionId) === onDrop) sectionDrops.delete(sectionId);
  };
}

/** Starts following the pointer after a press on a thread card. */
export function beginThreadDrag(
  event: ReactPointerEvent<HTMLElement>,
  threadId: string,
  group: ThreadDragGroup,
  onCard: (threadId: string, targetId: string, where: DropWhere) => void,
) {
  if (event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;
  let engaged = false;

  const move = (moveEvent: PointerEvent) => {
    if (!engaged) {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) <= ENGAGE_DISTANCE) {
        return;
      }
      engaged = true;
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }
    setTarget(
      targetAt(document.elementFromPoint(moveEvent.clientX, moveEvent.clientY), moveEvent.clientY, threadId, group),
    );
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", stop);
    document.removeEventListener("keydown", key, true);
    setTarget(null);
    if (!engaged) return;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    justDragged = true;
    window.setTimeout(() => {
      justDragged = false;
    }, 0);
  };
  const up = () => {
    const landed = target;
    stop();
    if (!engaged || landed === null) return;
    if (landed.kind === "card") onCard(threadId, landed.id, landed.where);
    else sectionDrops.get(landed.id)?.(threadId);
  };
  // The host sends Escape when its split drag takes over the gesture.
  const key = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key === "Escape") stop();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", stop);
  document.addEventListener("keydown", key, true);
}
