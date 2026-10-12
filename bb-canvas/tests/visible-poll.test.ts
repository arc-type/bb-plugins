import { afterEach, describe, expect, it, vi } from "vitest";
import { POLL_MS, startVisiblePoll } from "@/lib/visible-poll";

afterEach(() => vi.useRealTimers());

describe("startVisiblePoll (BBP-200)", () => {
  it("ticks every interval while the tab is visible", () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const stop = startVisiblePoll(tick, { visibilityState: "visible" });
    vi.advanceTimersByTime(POLL_MS * 2);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(POLL_MS);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("makes no call while the tab is hidden", () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const doc: { visibilityState: DocumentVisibilityState } = { visibilityState: "hidden" };
    startVisiblePoll(tick, doc);
    vi.advanceTimersByTime(POLL_MS * 3);
    expect(tick).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    vi.advanceTimersByTime(POLL_MS);
    expect(tick).toHaveBeenCalledTimes(1);
  });
});
