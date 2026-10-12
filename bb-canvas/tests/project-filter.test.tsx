// @vitest-environment jsdom
//
// The canvas project filter (BBP-181): which projects the page shows as
// roots, what survives a reload, and the toolbar dropdown that sets it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  initialProjectFilter,
  loadProjectFilter,
  PROJECT_FILTER_KEY,
  saveProjectFilter,
  visibleProjectIds,
} from "@/lib/project-filter";
import { ProjectFilter } from "@/components/ProjectFilter";

const projects = [
  { id: "p1", name: "Alpha" },
  { id: "p2", name: "Beta" },
  { id: "p3", name: "Gamma" },
];

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("visibleProjectIds", () => {
  it("shows every project when nothing is selected", () => {
    expect(visibleProjectIds([], projects)).toEqual(["p1", "p2", "p3"]);
  });

  it("shows only the selected projects, in list order", () => {
    expect(visibleProjectIds(["p3", "p1"], projects)).toEqual(["p1", "p3"]);
  });

  it("ignores unknown ids", () => {
    expect(visibleProjectIds(["gone", "p2"], projects)).toEqual(["p2"]);
  });

  it("falls back to every project when only unknown ids are selected", () => {
    expect(visibleProjectIds(["gone"], projects)).toEqual(["p1", "p2", "p3"]);
  });
});

describe("persistence", () => {
  it("starts empty with no storage entry", () => {
    expect(loadProjectFilter()).toEqual([]);
  });

  it("restores what was saved", () => {
    saveProjectFilter(["p1", "p2"]);
    expect(localStorage.getItem(PROJECT_FILTER_KEY)).toBe('["p1","p2"]');
    expect(loadProjectFilter()).toEqual(["p1", "p2"]);
  });

  it("drops a malformed entry instead of throwing", () => {
    localStorage.setItem(PROJECT_FILTER_KEY, "{not json");
    expect(loadProjectFilter()).toEqual([]);
    localStorage.setItem(PROJECT_FILTER_KEY, '{"p1":true}');
    expect(loadProjectFilter()).toEqual([]);
    localStorage.setItem(PROJECT_FILTER_KEY, '["p1",3,null]');
    expect(loadProjectFilter()).toEqual(["p1"]);
  });

  it("survives a storage that throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadProjectFilter()).toEqual([]);
    spy.mockRestore();
  });
});

describe("initialProjectFilter", () => {
  it("pre-selects the URL project over the stored selection", () => {
    expect(initialProjectFilter(["p1", "p2"], "p3")).toEqual(["p3"]);
  });

  it("keeps the stored selection without a URL project", () => {
    expect(initialProjectFilter(["p1"], null)).toEqual(["p1"]);
  });
});

describe("ProjectFilter dropdown", () => {
  it("says all projects when nothing is selected", () => {
    render(<ProjectFilter projects={projects} selected={[]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Projects: All/ })).toBeTruthy();
  });

  it("names a single selection, counts several", () => {
    const { rerender } = render(<ProjectFilter projects={projects} selected={["p2"]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Projects: Beta/ })).toBeTruthy();
    rerender(<ProjectFilter projects={projects} selected={["p1", "p2"]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Projects: 2 selected/ })).toBeTruthy();
  });

  it("toggles a project on and off", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ProjectFilter projects={projects} selected={[]} onChange={onChange} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma" }));
    expect(onChange).toHaveBeenLastCalledWith(["p3"]);
    rerender(<ProjectFilter projects={projects} selected={["p3"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("clears the selection with Clear selection", () => {
    const onChange = vi.fn();
    render(<ProjectFilter projects={projects} selected={["p1"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("shows an unknown stored id as all, not as a blank name", () => {
    render(<ProjectFilter projects={projects} selected={["gone"]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Projects: All/ })).toBeTruthy();
  });
});

describe("CanvasView toolbar slot", () => {
  it("renders page controls beside the colour toggle", async () => {
    const { CanvasView } = await import("@/components/CanvasView");
    render(
      <CanvasView
        nodes={[{ id: "a", kind: "agents", label: "Agents", parentId: null }]}
        toolbar={<ProjectFilter projects={projects} selected={[]} onChange={() => {}} />}
      />,
    );
    expect(screen.getByRole("button", { name: /Projects: All/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Colour:/ })).toBeTruthy();
  });

  it("renders no project filter when the page passes none", async () => {
    const { CanvasView } = await import("@/components/CanvasView");
    render(<CanvasView nodes={[{ id: "a", kind: "agents", label: "Agents", parentId: null }]} />);
    expect(screen.queryByRole("button", { name: /Projects:/ })).toBeNull();
  });
});
