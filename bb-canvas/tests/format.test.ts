import { describe, expect, it } from "vitest";
import { formatTimeRange, formatTimestamp } from "@/lib/format";

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

describe("formatTimeRange", () => {
  it("gives the start with seconds and a same-day end as a bare clock time", () => {
    const start = Date.UTC(2026, 9, 6, 17, 15, 2);
    expect(formatTimeRange(start, start + 1500)).toEqual({ startedAt: "2026-10-06 17:15:02 UTC", completedAt: "17:15:03 UTC" });
  });

  it("keeps the date on an end that falls on another day, and drops missing times", () => {
    const start = Date.UTC(2026, 9, 6, 23, 59, 59);
    expect(formatTimeRange(start, start + 2000)).toEqual({ startedAt: "2026-10-06 23:59:59 UTC", completedAt: "2026-10-07 00:00:01 UTC" });
    expect(formatTimeRange(undefined, 0)).toEqual({});
  });
});

