import { describe, expect, it } from "vitest";
import { formatTimestamp } from "@/lib/format";

describe("formatTimestamp", () => {
  it("formats epoch milliseconds as a minute-precise UTC stamp", () => {
    expect(formatTimestamp(Date.UTC(2026, 9, 12, 8, 53, 41))).toBe("2026-10-12 08:53 UTC");
  });

  it("returns undefined for a missing or invalid time instead of 'Invalid Date'", () => {
    expect(formatTimestamp(undefined)).toBeUndefined();
    expect(formatTimestamp(null)).toBeUndefined();
    expect(formatTimestamp(Number.NaN)).toBeUndefined();
    expect(formatTimestamp(0)).toBeUndefined();
  });
});
