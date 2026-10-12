import { describe, expect, it } from "vitest";
import { clampWidth, DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH } from "@/lib/clampWidth";

describe("clampWidth", () => {
  it("keeps an in-range width as is", () => {
    expect(clampWidth(400)).toBe(400);
    expect(clampWidth(MIN_WIDTH)).toBe(240);
    expect(clampWidth(MAX_WIDTH)).toBe(640);
  });

  it("caps a width below the minimum at the minimum", () => {
    expect(clampWidth(239)).toBe(240);
    expect(clampWidth(-1000)).toBe(240);
  });

  it("caps a width above the maximum at the maximum", () => {
    expect(clampWidth(641)).toBe(640);
    expect(clampWidth(99999)).toBe(640);
  });

  it("falls back to the default for a non-finite value", () => {
    expect(DEFAULT_WIDTH).toBe(320);
    expect(clampWidth(Number.NaN)).toBe(320);
    expect(clampWidth(Number.POSITIVE_INFINITY)).toBe(320);
  });
});
