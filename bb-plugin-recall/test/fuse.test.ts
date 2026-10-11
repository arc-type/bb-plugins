import { describe, expect, it } from "vitest";
import { fuseRanked } from "../lib/fuse.js";

const hits = (...keys: string[]) => keys.map((key) => ({ key }));

describe("fuseRanked", () => {
  it("ranks a document found by both sources above single-source ones", () => {
    const result = fuseRanked([hits("a", "b"), hits("c", "b")], 10);
    expect(result[0]).toMatchObject({ key: "b", sources: 2 });
    expect(result.map((hit) => hit.key).sort()).toEqual(["a", "b", "c"]);
  });

  it("does not count a duplicate inside one source twice", () => {
    const result = fuseRanked([hits("a", "a", "a"), hits("b")], 10);
    expect(result.find((hit) => hit.key === "a")?.sources).toBe(1);
  });

  it("respects the limit, including zero", () => {
    expect(fuseRanked([hits("a", "b", "c")], 2)).toHaveLength(2);
    expect(fuseRanked([hits("a")], 0)).toHaveLength(0);
  });

  it("keeps the order of a single source", () => {
    expect(fuseRanked([hits("x", "y", "z")], 10).map((hit) => hit.key)).toEqual(["x", "y", "z"]);
  });
});
