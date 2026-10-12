// BBP-179: where the project dropdown opens, so it never leaves the canvas.
import { describe, expect, it } from "vitest";
import { placePopover } from "../lib/popover";

const bounds = { left: 0, right: 400 };

describe("placePopover", () => {
  it("aligns its right edge to the anchor's when that fits", () => {
    expect(placePopover({ left: 300, right: 380 }, bounds, 200)).toEqual({ offset: -120, width: 200 });
  });

  it("shifts right when opening left would cross the left edge", () => {
    expect(placePopover({ left: 20, right: 100 }, bounds, 200)).toEqual({ offset: -12, width: 200 });
  });

  it("shifts left when the anchor itself sits past the right edge", () => {
    expect(placePopover({ left: 380, right: 460 }, bounds, 200)).toEqual({ offset: -188, width: 200 });
  });

  it("negative: never wider than the bounds allow", () => {
    expect(placePopover({ left: 100, right: 180 }, { left: 0, right: 150 }, 200)).toEqual({ offset: -92, width: 134 });
  });
});
