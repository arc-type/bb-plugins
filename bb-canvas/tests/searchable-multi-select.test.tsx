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

  it("hides Select all matches when nothing matches the query", () => {
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={() => {}} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Select all matches" })).toBeNull();
  });

  it("puts checked options that no longer match the query under a Selected heading", () => {
    render(
      <SearchableMultiSelect label="Projects" options={options} selected={["p3", "p1"]} onChange={() => {}} emptyText="No projects yet." />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "et" } });
    // Beta matches "et" and stays an ordinary match; Alpha/Gamma are checked but don't match.
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeTruthy();
    expect(screen.getByText("Selected")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Gamma" })).toBeTruthy();
    expect(screen.queryByText("No matches")).toBeNull();
  });

  it("shows the Selected heading, and no Select all matches, when the query matches nothing but something is checked", () => {
    render(
      <SearchableMultiSelect label="Projects" options={options} selected={["p1"]} onChange={() => {}} emptyText="No projects yet." />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeTruthy();
    expect(screen.getByText("Selected")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Select all matches" })).toBeNull();
  });

  it("Enter in the search field checks the first visible match when no row is active", () => {
    const onChange = vi.fn();
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={onChange} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["p1"]);
  });

  it("Enter in the search field checks the highlighted row when one is active", () => {
    const onChange = vi.fn();
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={onChange} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Alpha" }), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Beta" }), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["p2"]);
  });

  it("moves a project checked while open into Selected as soon as it no longer matches the query (BBP-218)", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={onChange} emptyText="No projects yet." />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    // Check Gamma while the dropdown is open (not checked at open time).
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma" }));
    expect(onChange).toHaveBeenLastCalledWith(["p3"]);
    rerender(
      <SearchableMultiSelect label="Projects" options={options} selected={["p3"]} onChange={onChange} emptyText="No projects yet." />,
    );
    // Now type a query that Gamma no longer matches: it must appear under Selected right away.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "et" } });
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeTruthy();
    expect(screen.getByText("Selected")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Gamma" })).toBeTruthy();
    expect(screen.queryByText("No matches")).toBeNull();
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

  it("stays a flat list with no group headers when options have no group (Projects regression, BBP-239)", () => {
    render(
      <SearchableMultiSelect label="Projects" options={options} selected={["p1"]} onChange={() => {}} emptyText="No projects yet." />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    expect(screen.queryAllByRole("presentation")).toHaveLength(0);
    expect(screen.getAllByRole("checkbox").map((checkbox) => checkbox.getAttribute("aria-label"))).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });

  const groupedOptions = [
    { id: "c1", name: "Alpha crew", group: "Crews" },
    { id: "t1", name: "Beta thread", group: "Threads" },
    { id: "c2", name: "Gamma crew", group: "Crews" },
  ];

  it("clusters grouped options under a non-interactive header per group, in first-occurrence order (BBP-239)", () => {
    render(
      <SearchableMultiSelect label="Focus" options={groupedOptions} selected={[]} onChange={() => {}} emptyText="Nothing yet." />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Focus:/ }));
    const group = screen.getByRole("group", { name: "Focus" });
    const headings = group.querySelectorAll('[role="presentation"]');
    expect(Array.from(headings).map((node) => node.textContent)).toEqual(["Crews", "Threads"]);
    // First occurrence of "Crews" comes before "Threads" even though Threads is alphabetically first.
    const labels = screen.getAllByRole("checkbox").map((checkbox) => checkbox.getAttribute("aria-label"));
    expect(labels).toEqual(["Alpha crew", "Gamma crew", "Beta thread"]);
  });

  it("matches on keywords in addition to name, case-insensitively (BBP-239)", () => {
    const keywordOptions = [
      { id: "t1", name: "Release planning", keywords: ["thr_abc123"] },
      { id: "t2", name: "Bug triage", keywords: ["thr_xyz999"] },
    ];
    render(
      <SearchableMultiSelect label="Focus" options={keywordOptions} selected={[]} onChange={() => {}} emptyText="Nothing yet." />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Focus:/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ABC123" } });
    expect(screen.getByRole("checkbox", { name: "Release planning" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Bug triage" })).toBeNull();
  });

  it("keeps group headers across the checked/unchecked split and keeps group order stable while checking a row", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SearchableMultiSelect label="Focus" options={groupedOptions} selected={["c1"]} onChange={onChange} emptyText="Nothing yet." />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Focus:/ }));
    // Alpha crew (checked) is pinned above the divider under its own "Crews" header;
    // Beta thread and Gamma crew remain below, grouped in their frozen-order appearance.
    let group = screen.getByRole("group", { name: "Focus" });
    expect(Array.from(group.querySelectorAll('[role="presentation"]')).map((node) => node.textContent)).toEqual([
      "Crews",
      "Threads",
      "Crews",
    ]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma crew" }));
    expect(onChange).toHaveBeenLastCalledWith(["c1", "c2"]);
    rerender(
      <SearchableMultiSelect label="Focus" options={groupedOptions} selected={["c1", "c2"]} onChange={onChange} emptyText="Nothing yet." />,
    );
    // The frozen split keeps Gamma crew below the divider despite now being checked.
    group = screen.getByRole("group", { name: "Focus" });
    expect(Array.from(group.querySelectorAll('[role="presentation"]')).map((node) => node.textContent)).toEqual([
      "Crews",
      "Threads",
      "Crews",
    ]);
  });

  it("uses a custom summarize to override the default button label (BBP-240)", () => {
    const summarize = (opts: typeof options, selected: readonly string[]) =>
      selected.length === 0 ? "All" : `Focus (${selected.length})`;
    const { rerender } = render(
      <SearchableMultiSelect
        label="Focus"
        options={options}
        selected={[]}
        onChange={() => {}}
        emptyText="Nothing yet."
        summarize={summarize}
      />,
    );
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    rerender(
      <SearchableMultiSelect
        label="Focus"
        options={options}
        selected={["p1", "p2"]}
        onChange={() => {}}
        emptyText="Nothing yet."
        summarize={summarize}
      />,
    );
    expect(screen.getByRole("button", { name: "Focus (2)" })).toBeTruthy();
  });
  // BBP-227: checking a row with the mouse hands focus back to the search
  // field, so typing goes on into the search instead of onto the row.
  it("clicking a row with the mouse puts focus back into the search field", () => {
    const onChange = vi.fn();
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={onChange} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    const beta = screen.getByRole("checkbox", { name: "Beta" });
    fireEvent.mouseDown(beta);
    fireEvent.click(beta);
    expect(onChange).toHaveBeenLastCalledWith(["p2"]);
    expect(screen.getByRole("searchbox")).toBe(document.activeElement);
  });

  it("checking a row with Space keeps focus on that row", () => {
    const onChange = vi.fn();
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={onChange} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Alpha" }), { key: " " });
    expect(onChange).toHaveBeenLastCalledWith(["p1"]);
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBe(document.activeElement);
  });

  it("typing a character on a row jumps into the search field and appends it", () => {
    render(<SearchableMultiSelect label="Projects" options={options} selected={[]} onChange={() => {}} emptyText="No projects yet." />);
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Alpha" }), { key: "g" });
    const search = screen.getByRole("searchbox") as HTMLInputElement;
    expect(search).toBe(document.activeElement);
    expect(search.value).toBe("g");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Gamma" }), { key: "Backspace" });
    expect(screen.getByRole("checkbox", { name: "Gamma" })).toBe(document.activeElement);
    expect(search.value).toBe("g");
  });
});
