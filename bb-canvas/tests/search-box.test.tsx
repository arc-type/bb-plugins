// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchBox } from "@/components/SearchBox";

afterEach(cleanup);

describe("SearchBox", () => {
  it("focuses the input on mount", () => {
    render(<SearchBox value="" onChange={vi.fn()} onSubmit={() => true} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it("submits on Enter", () => {
    const onSubmit = vi.fn(() => true);
    render(<SearchBox value="orch" onChange={vi.fn()} onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("shows 'no match' when the submit finds nothing", () => {
    render(<SearchBox value="nope" onChange={vi.fn()} onSubmit={() => false} onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(screen.getByText("no match")).toBeTruthy();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<SearchBox value="" onChange={vi.fn()} onSubmit={() => true} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
