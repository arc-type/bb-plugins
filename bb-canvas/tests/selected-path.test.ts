import { describe, expect, it } from "vitest";
import { selectedPathEdges } from "@/lib/selected-path";

function parents(entries: Record<string, string | null>): Map<string, string | null> {
  return new Map(Object.entries(entries));
}

describe("selectedPathEdges (BBP-220)", () => {
  it("highlights every node from the root down to a deeply nested selection", () => {
    const parentIdOf = parents({ run: null, a: "run", b: "a", c: "b" });
    const onPath = selectedPathEdges("c", parentIdOf);
    expect([...onPath].sort()).toEqual(["a", "b", "c"]);
  });

  it("negative: no selection yields an empty path", () => {
    const parentIdOf = parents({ run: null, a: "run" });
    expect(selectedPathEdges(null, parentIdOf).size).toBe(0);
  });

  it("negative: a selection missing from parentIdOf yields an empty path", () => {
    const parentIdOf = parents({ run: null, a: "run" });
    expect(selectedPathEdges("ghost", parentIdOf).size).toBe(0);
  });
});
