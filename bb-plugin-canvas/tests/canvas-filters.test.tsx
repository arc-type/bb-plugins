// @vitest-environment jsdom
//
// The time window menu (BBP-287): a window from the plugin settings that is
// none of the presets shows as its own option; a preset never adds one.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasFilters } from "../components/canvas-filters";
import { DEFAULT_THREAD_FILTER } from "../vendor/bb-canvas/lib/thread-filter";

afterEach(cleanup);

const HOUR = 3_600_000;
const renderWindow = (windowMs: number) => {
  render(<CanvasFilters projects={[]} filter={{ ...DEFAULT_THREAD_FILTER, windowMs }} onChange={() => {}} />);
  return screen.getByRole("combobox", { name: "Time window" }) as HTMLSelectElement;
};
const labels = (select: HTMLSelectElement) => Array.from(select.options).map((option) => option.text);

describe("the Canvas time window menu", () => {
  it("shows a settings window outside the presets as its own, selected option", () => {
    const select = renderWindow(36 * HOUR);
    expect(labels(select)).toContain("Last 36 hours");
    expect(select.selectedOptions[0]!.text).toBe("Last 36 hours");
  });

  it("adds no custom option for a preset window", () => {
    const select = renderWindow(12 * HOUR);
    expect(labels(select)).toEqual(["Any time", "Last hour", "Last 12 hours", "Last 24 hours", "Last 7 days", "Last 30 days"]);
    expect(select.value).toBe("12h");
  });
});
