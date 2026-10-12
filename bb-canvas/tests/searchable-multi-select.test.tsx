// @vitest-environment jsdom
//
// SearchableMultiSelect (BBP-211): generic popover multi-select extracted
// from ProjectFilter. This ticket only covers open/check/clear selection —
// search and keyboard navigation land in BBP-212/BBP-213.
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
});
