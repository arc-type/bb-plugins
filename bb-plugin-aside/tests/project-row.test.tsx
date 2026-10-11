// @vitest-environment jsdom
//
// Projects reorder the same way threads do (BBP-152): pointer events on the
// avatar badge, a line on the row the pointer is over, only in Manual sort.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_useSidebarThreadActions: () => ({
    openNewThread: vi.fn(),
  }),
}));

const { ProjectRow } = await import("@/components/sidenav/project-row");

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function project(id: string, name: string): PluginSidebarProject {
  return { id, name, isPersonal: false, href: "", settingsHref: "" };
}

function row(overrides: Partial<React.ComponentProps<typeof ProjectRow>> = {}) {
  return (
    <ProjectRow
      project={project("p1", "Alpha")}
      color={null}
      tags={[]}
      knownTags={[]}
      threadCount={0}
      waitingCount={0}
      state="quiet"
      age={null}
      now={0}
      collapsed
      renaming={false}
      onToggle={vi.fn()}
      onSolo={vi.fn()}
      sectionsCollapsed={null}
      onToggleSections={vi.fn()}
      onStartRename={vi.fn()}
      onCancelRename={vi.fn()}
      onRename={vi.fn()}
      onSetColor={vi.fn()}
      onSetTags={vi.fn()}
      manualSort
      onReorder={vi.fn()}
      {...overrides}
    >
      {null}
    </ProjectRow>
  );
}

function pointAt(element: Element | null) {
  document.elementFromPoint = vi.fn(() => element);
}

function press(name: string) {
  fireEvent.pointerDown(screen.getByTitle(`${name} — drag to reorder projects`), {
    button: 0,
    clientX: 10,
    clientY: 10,
  });
}

describe("project row drag", () => {
  it("drops onto another project's block, not just its header", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <>
        {row({ project: project("p1", "Alpha"), onReorder: vi.fn() })}
        {row({ project: project("p2", "Beta"), onReorder })}
      </>,
    );
    const target = container.querySelector('[data-aside-project="p2"]')!;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 100, height: 100, left: 0, right: 200, width: 200, x: 0, y: 0,
      toJSON: () => ({}),
    });
    pointAt(target);
    press("Alpha");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 90 });
    fireEvent.pointerUp(window);
    expect(onReorder).toHaveBeenCalledWith("p1", "after");
  });

  it("shows no line outside Manual sort, though the drag still runs", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <>
        {row({ project: project("p1", "Alpha"), onReorder: vi.fn() })}
        {row({ project: project("p2", "Beta"), onReorder, manualSort: false })}
      </>,
    );
    const target = container.querySelector('[data-aside-project="p2"]')!;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 100, height: 100, left: 0, right: 200, width: 200, x: 0, y: 0,
      toJSON: () => ({}),
    });
    pointAt(target);
    press("Alpha");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 90 });
    const header = screen.getByText("Beta").closest(".sticky")!;
    expect(header.className).not.toContain("shadow-[inset");
    fireEvent.pointerUp(window);
    expect(onReorder).toHaveBeenCalledWith("p1", "after");
  });

  it("swallows the click that ends a drag, so the project does not toggle", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <>
        {row({ project: project("p1", "Alpha"), onToggle })}
        {row({ project: project("p2", "Beta") })}
      </>,
    );
    const target = container.querySelector('[data-aside-project="p2"]')!;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 100, height: 100, left: 0, right: 200, width: 200, x: 0, y: 0,
      toJSON: () => ({}),
    });
    pointAt(target);
    press("Alpha");
    fireEvent.pointerMove(window, { clientX: 10, clientY: 90 });
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByTitle("Alpha — drag to reorder projects"));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
