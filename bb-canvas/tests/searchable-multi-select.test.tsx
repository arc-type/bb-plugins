// @vitest-environment jsdom
//
// SearchableMultiSelect (BBP-211): generic popover multi-select extracted
// from ProjectFilter. BBP-212 adds the search field; keyboard navigation
// lands in BBP-213.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";

const options = [
  { id: "p1", name: "Alpha" },
  { id: "p2", name: "Beta" },
  { id: "p3", name: "Gamma" },
];

afterEach(cleanup);

describe("SearchableMultiSelect", () => {
  it("opens the popover on click, listing every option", () => {
    render(
      <SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={() => {}} emptyText="No projects yet." />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Gamma" })).toBeTruthy();
  });

  it("checks and unchecks an option", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={onChange} emptyText="No projects yet." />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma" }));
    expect(onChange).toHaveBeenLastCalledWith(["p3"]);
    rerender(
      <SearchableMultiSelect label="Projects" options={options} selected={["p3"]} onChange={onChange} emptyText="No projects yet." />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("clears the selection with Clear selection", () => {
    const onChange = vi.fn();
    render(
      <SearchableMultiSelect label="Projects" options={options} selected={["p1"]} onChange={onChange} emptyText="No projects yet." />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("closes when clicking outside", () => {
    render(
      <div>
        <div data-testid="outside" />
        <SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={() => {}} emptyText="No projects yet." />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    expect(screen.getByRole("group", { name: "Projects" })).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("group", { name: "Projects" })).toBeNull();
  });

  it("shows emptyText when there are no options", () => {
    render(<SearchableMultiSelect label="Projects" options={[]} selected={[]} onChange={() => {}} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    expect(screen.getByText("No projects yet.")).toBeTruthy();
  });

  it("stops Escape from reaching canvas shortcuts and closes the popover", () => {
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={() => {}} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.keyDown(screen.getByRole("group", { name: "Projects" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Projects" })).toBeNull();
  });

  it("focuses the search field on open", () => {
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={() => {}} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    expect(screen.getByRole("searchbox")).toBe(document.activeElement);
  });

  it("filters by case-insensitive substring and marks the first match", () => {
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={() => {}} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ET" } });
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Alpha" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Gamma" })).toBeNull();
    const mark = screen.getByText("et", { selector: "mark" });
    expect(mark).toBeTruthy();
  });

  it("keeps checked options pinned above the divider, alphabetically, in frozen order", () => {
    const onChange = vi.fn();
    render(
      <SearchableMultiSelect
        label="Projects"
        options={options}
        selected={["p3", "p1"]}
        onChange={onChange}
        emptyText="No projects yet."
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "xyz" } });
    // Checked options stay visible even though they don't match the query.
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Gamma" })).toBeTruthy();
    const labels = screen.getAllByRole("checkbox").map((checkbox) => checkbox.getAttribute("aria-label"));
    expect(labels).toEqual(["Alpha", "Gamma"]);
  });

  it("only shows Select all matches when a query is present, and it adds the matches", () => {
    const onChange = vi.fn();
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={onChange} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    expect(screen.queryByRole("button", { name: "Select all matches" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Select all matches" }));
    expect(onChange).toHaveBeenLastCalledWith(["p1", "p2", "p3"]);
  });

  it("shows No matches without losing the current selection", () => {
    const onChange = vi.fn();
    render(
      <SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={onChange} emptyText="No projects yet." />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Escape clears the query first, then closes the popover on the next Escape", () => {
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={() => {}} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "al" } });
    fireEvent.keyDown(screen.getByRole("group", { name: "Projects" }), { key: "Escape" });
    expect(screen.getByRole("group", { name: "Projects" })).toBeTruthy();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    fireEvent.keyDown(screen.getByRole("group", { name: "Projects" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Projects" })).toBeNull();
  });

  it("resets the query when closed and reopened", () => {
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={() => {}} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "al" } });
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeTruthy();
  });

  it("ArrowDown moves from the search field onto the first row, then on through the list", () => {
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={() => {}} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBe(document.activeElement);
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Alpha" }), { key: "ArrowDown" });
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBe(document.activeElement);
  });

  it("ArrowUp moves back up the list and stops at the top row", () => {
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={() => {}} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Alpha" }), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Beta" }), { key: "ArrowUp" });
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBe(document.activeElement);
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Alpha" }), { key: "ArrowUp" });
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBe(document.activeElement);
  });

  it("navigates the frozen order, not a re-sorted one, while arrowing through matches", () => {
    const onChange = vi.fn();
    render(
      <SearchableMultiSelect label="Projects" options={options} selected={["p3"]} onChange={onChange} emptyText="No projects yet." />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    // Gamma is pinned above the divider; Alpha and Beta follow below it.
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    expect(screen.getByRole("checkbox", { name: "Gamma" })).toBe(document.activeElement);
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Gamma" }), { key: "ArrowDown" });
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBe(document.activeElement);
  });

  it("Space toggles the active row", () => {
    const onChange = vi.fn();
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={onChange} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Alpha" }), { key: " " });
    expect(onChange).toHaveBeenLastCalledWith(["p1"]);
  });

  it("Enter toggles the active row", () => {
    const onChange = vi.fn();
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={onChange} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Alpha" }), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["p1"]);
  });

  it("keeps the checked/unchecked block split frozen while checking or unchecking a row", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchableMultiSelect label="Projects" options={options} selected={["p1"]} onChange={onChange} emptyText="No projects yet." />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    // Alpha (p1) is checked, pinned above the divider; Beta and Gamma remain below.
    expect(screen.getAllByRole("checkbox").map((checkbox) => checkbox.getAttribute("aria-label"))).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma" }));
    expect(onChange).toHaveBeenLastCalledWith(["p1", "p3"]);
    // Checking Gamma must not move it above the divider: the split froze at open time.
    rerender(
      <SearchableMultiSelect label="Projects" options={options} selected={["p1", "p3"]} onChange={onChange} emptyText="No projects yet." />,
    );
    expect(screen.getAllByRole("checkbox").map((checkbox) => checkbox.getAttribute("aria-label"))).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    expect(onChange).toHaveBeenLastCalledWith(["p3"]);
    // Unchecking Alpha must not move it down: it stays in the frozen checked block.
    rerender(
      <SearchableMultiSelect label="Projects" options={options} selected={["p3"]} onChange={onChange} emptyText="No projects yet." />,
    );
    expect(screen.getAllByRole("checkbox").map((checkbox) => checkbox.getAttribute("aria-label"))).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });

  it("does not let ArrowDown, Space or Enter reach the canvas's own shortcuts", () => {
    const canvasShortcut = vi.fn();
    render(
      <div onKeyDown={canvasShortcut}>
        <SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={() => {}} emptyText="No projects yet." />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Alpha" }), { key: " " });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Alpha" }), { key: "Enter" });
    expect(canvasShortcut).not.toHaveBeenCalled();
  });
});
