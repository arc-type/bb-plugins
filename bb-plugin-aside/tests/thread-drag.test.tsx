// @vitest-environment jsdom
//
// Thread cards drag on pointer events: the host's split props block native
// drags on the card (BBP-136). These pin the gesture down. Project rows share
// the same mechanism (BBP-152).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SectionRow } from "@/components/sidenav/section-row";
import {
  beginProjectDrag,
  beginThreadDrag,
  consumeDragClick,
  dropWhereAt,
  registerProjectDrop,
} from "@/components/sidenav/thread-drag";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function card(id: string, group: "list" | "pinned" = "list") {
  const element = document.createElement("div");
  element.dataset.asideCard = id;
  element.dataset.asideGroup = group;
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top: 0, bottom: 100, height: 100, left: 0, right: 200, width: 200, x: 0, y: 0,
    toJSON: () => ({}),
  });
  document.body.append(element);
  return element;
}

function press(threadId: string, onCard = vi.fn(), group: "list" | "pinned" = "list") {
  beginThreadDrag(
    { button: 0, clientX: 10, clientY: 10 } as unknown as React.PointerEvent<HTMLElement>,
    threadId,
    group,
    onCard,
  );
  return onCard;
}

function pointAt(element: Element | null) {
  document.elementFromPoint = vi.fn(() => element);
}

function project(id: string) {
  const element = document.createElement("section");
  element.dataset.asideProject = id;
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top: 0, bottom: 100, height: 100, left: 0, right: 200, width: 200, x: 0, y: 0,
    toJSON: () => ({}),
  });
  document.body.append(element);
  return element;
}

function pressProject(projectId: string) {
  beginProjectDrag(
    { button: 0, clientX: 10, clientY: 10 } as unknown as React.PointerEvent<HTMLElement>,
    projectId,
  );
}

describe("thread drag", () => {
  it("splits a card into before and after, never into", () => {
    expect(dropWhereAt(0.1)).toBe("before");
    expect(dropWhereAt(0.49)).toBe("before");
    expect(dropWhereAt(0.5)).toBe("after");
    expect(dropWhereAt(0.9)).toBe("after");
  });

  it("reorders onto another card and swallows the following click", () => {
    const target = card("t2");
    pointAt(target);
    const onCard = press("t1");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 90 });
    fireEvent.pointerUp(window);
    expect(onCard).toHaveBeenCalledWith("t1", "t2", "after");
    expect(consumeDragClick()).toBe(true);
  });

  it("treats a press without movement as a click", async () => {
    // Let the latch of an earlier drag run out first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    pointAt(card("t2"));
    const onCard = press("t1");
    fireEvent.pointerUp(window);
    expect(onCard).not.toHaveBeenCalled();
    expect(consumeDragClick()).toBe(false);
  });

  it("drops onto a section row", () => {
    const onDropThread = vi.fn();
    render(
      <SectionRow
        id="s1" name="Backlog" count={1} state="quiet" age={null} now={0}
        collapsed={false} renaming={false} threadCount={1} projectCount={1}
        onToggle={vi.fn()} onStartRename={vi.fn()} onCancelRename={vi.fn()}
        onRename={vi.fn()} onDissolve={vi.fn()} onDropThread={onDropThread}
        onNewThread={vi.fn()} onReorder={vi.fn()}
      />,
    );
    pointAt(screen.getByText("Backlog"));
    press("t1");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 40 });
    fireEvent.pointerUp(window);
    expect(onDropThread).toHaveBeenCalledWith("t1");
  });

  it("gives the gesture up when the host's split drag takes over", () => {
    pointAt(card("t2"));
    const onCard = press("t1");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 90 });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerUp(window);
    expect(onCard).not.toHaveBeenCalled();
  });

  it("reorders inside the pinned group, without nesting", () => {
    pointAt(card("t2", "pinned"));
    const onCard = press("t1", vi.fn(), "pinned");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 45 });
    fireEvent.pointerUp(window);
    expect(onCard).toHaveBeenCalledWith("t1", "t2", "before");
  });

  it("does not drop a pin onto the list's copy of a thread", () => {
    pointAt(card("t2", "list"));
    const onCard = press("t1", vi.fn(), "pinned");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 45 });
    fireEvent.pointerUp(window);
    expect(onCard).not.toHaveBeenCalled();
  });
});

describe("project drag", () => {
  it("measures the half over the whole project block, not just its header", () => {
    const target = project("p2");
    pointAt(target);
    const onDrop = vi.fn();
    registerProjectDrop("p2", onDrop);
    pressProject("p1");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 90 });
    fireEvent.pointerUp(window);
    expect(onDrop).toHaveBeenCalledWith("p1", "after");
  });

  it("drops before when the pointer sits in the upper half", () => {
    const target = project("p2");
    pointAt(target);
    const onDrop = vi.fn();
    registerProjectDrop("p2", onDrop);
    pressProject("p1");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 40 });
    fireEvent.pointerUp(window);
    expect(onDrop).toHaveBeenCalledWith("p1", "before");
  });

  it("never targets the project being dragged", () => {
    const target = project("p1");
    pointAt(target);
    const onDrop = vi.fn();
    registerProjectDrop("p1", onDrop);
    pressProject("p1");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 90 });
    fireEvent.pointerUp(window);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("swallows the click that follows a completed project drag", () => {
    pointAt(project("p2"));
    pressProject("p1");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 90 });
    fireEvent.pointerUp(window);
    expect(consumeDragClick()).toBe(true);
  });

  it("gives the gesture up when the host's split drag takes over", () => {
    pointAt(project("p2"));
    const onDrop = vi.fn();
    registerProjectDrop("p2", onDrop);
    pressProject("p1");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 90 });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerUp(window);
    expect(onDrop).not.toHaveBeenCalled();
  });
});
