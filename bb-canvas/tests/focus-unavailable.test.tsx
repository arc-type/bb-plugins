// @vitest-environment jsdom
//
// The vanished-focus empty state (BBP-204): message plus a working "Show all".
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FocusUnavailable } from "@/components/FocusUnavailable";

afterEach(cleanup);

describe("FocusUnavailable", () => {
  it("names the problem and offers Show all", () => {
    const onShowAll = vi.fn();
    render(<FocusUnavailable onShowAll={onShowAll} />);
    expect(screen.getByRole("status").textContent).toContain("Focused items are no longer available");
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it("does not call Show all on its own", () => {
    const onShowAll = vi.fn();
    render(<FocusUnavailable onShowAll={onShowAll} />);
    expect(onShowAll).not.toHaveBeenCalled();
  });
});
