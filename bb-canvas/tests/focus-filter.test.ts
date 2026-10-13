// @vitest-environment jsdom
//
// The canvas focus filter (BBP-238): which nodes the canvas shows when one
// or more crews, graph runs or threads are focused — their whole subtree
// plus the path to the root — and what survives a reload.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FOCUS_FILTER_KEY,
  focusPathIds,
  loadFocusFilter,
  missingFocusIds,
  saveFocusFilter,
  visibleFocusIds,
} from "@/lib/focus-filter";
import type { CanvasNode } from "@/lib/types";

const node = (id: string, parentId: string | null): CanvasNode => ({
  id,
  kind: "thread",
  label: id,
  parentId,
});

// root -> a -> b -> c
//      -> d
const nodes: CanvasNode[] = [
  node("root", null),
  node("a", "root"),
  node("b", "a"),
  node("c", "b"),
  node("d", "root"),
];

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("visibleFocusIds", () => {
  it("shows every node when nothing is selected", () => {
    expect(visibleFocusIds(nodes, [])).toEqual(new Set(["root", "a", "b", "c", "d"]));
  });

  it("shows the selected node, its whole subtree, and the path to the root", () => {
    expect(visibleFocusIds(nodes, ["a"])).toEqual(new Set(["root", "a", "b", "c"]));
  });

  it("shows a leaf selection with no subtree beyond itself, plus its path", () => {
    expect(visibleFocusIds(nodes, ["c"])).toEqual(new Set(["root", "a", "b", "c"]));
  });

  it("unions the subtrees and paths of multiple selected nodes", () => {
    expect(visibleFocusIds(nodes, ["b", "d"])).toEqual(new Set(["root", "a", "b", "c", "d"]));
  });

  it("drops a selected id no longer present in nodes instead of throwing", () => {
    expect(visibleFocusIds(nodes, ["gone"])).toEqual(new Set());
  });

  it("keeps the rest when only some selected ids have disappeared", () => {
    expect(visibleFocusIds(nodes, ["gone", "d"])).toEqual(new Set(["root", "d"]));
  });
});

describe("focusPathIds", () => {
  it("returns no path when nothing is selected", () => {
    expect(focusPathIds(nodes, [])).toEqual(new Set());
  });

  it("returns only the ancestors, not the subtree, of the selected node", () => {
    expect(focusPathIds(nodes, ["b"])).toEqual(new Set(["root", "a"]));
  });

  it("does not include the selected node itself among path nodes beyond its ancestors", () => {
    const path = focusPathIds(nodes, ["a"]);
    expect(path.has("b")).toBe(false);
    expect(path.has("c")).toBe(false);
  });

  it("unions the paths of multiple selected nodes", () => {
    expect(focusPathIds(nodes, ["c", "d"])).toEqual(new Set(["root", "a", "b"]));
  });

  it("ignores a selected id no longer present in nodes", () => {
    expect(focusPathIds(nodes, ["gone"])).toEqual(new Set());
  });
});

describe("missingFocusIds", () => {
  it("is empty when every selected id is still present", () => {
    expect(missingFocusIds(nodes, ["a", "d"])).toEqual([]);
  });

  it("lists selected ids no longer present in nodes", () => {
    expect(missingFocusIds(nodes, ["a", "gone"])).toEqual(["gone"]);
  });

  it("lists every selected id when all have disappeared", () => {
    expect(missingFocusIds(nodes, ["gone1", "gone2"])).toEqual(["gone1", "gone2"]);
  });

  it("is empty for an empty selection", () => {
    expect(missingFocusIds(nodes, [])).toEqual([]);
  });
});

describe("persistence", () => {
  it("starts empty with no storage entry", () => {
    expect(loadFocusFilter()).toEqual([]);
  });

  it("restores what was saved", () => {
    saveFocusFilter(["a", "b"]);
    expect(localStorage.getItem(FOCUS_FILTER_KEY)).toBe('["a","b"]');
    expect(loadFocusFilter()).toEqual(["a", "b"]);
  });

  it("drops a malformed entry instead of throwing", () => {
    localStorage.setItem(FOCUS_FILTER_KEY, "{not json");
    expect(loadFocusFilter()).toEqual([]);
    localStorage.setItem(FOCUS_FILTER_KEY, '{"a":true}');
    expect(loadFocusFilter()).toEqual([]);
    localStorage.setItem(FOCUS_FILTER_KEY, '["a",3,null]');
    expect(loadFocusFilter()).toEqual(["a"]);
  });

  it("survives a storage that throws on read", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadFocusFilter()).toEqual([]);
    spy.mockRestore();
  });

  it("survives a storage that throws on write", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => saveFocusFilter(["a"])).not.toThrow();
    spy.mockRestore();
  });
});
