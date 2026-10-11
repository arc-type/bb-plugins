// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NodeCard } from "@/components/NodeCard";

afterEach(cleanup);

describe("NodeCard", () => {
  it("renders the label as its accessible name", () => {
    render(<NodeCard label="orch-lead" />);
    expect(screen.getByRole("button", { name: "orch-lead" })).toBeTruthy();
  });

  it("folds the subtitle into the accessible name", () => {
    render(<NodeCard label="orch-lead" subtitle="lead" />);
    expect(screen.getByRole("button", { name: "orch-lead — lead" })).toBeTruthy();
  });

  it("calls onClick when pressed", () => {
    const onClick = vi.fn();
    render(<NodeCard label="orch-lead" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("marks itself pressed when selected", () => {
    render(<NodeCard label="orch-lead" selected />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows no status dot when status is absent", () => {
    render(<NodeCard label="orch-lead" />);
    expect(screen.queryByTitle("running")).toBeNull();
  });

  it("shows a status dot with the status as its title", () => {
    render(<NodeCard label="orch-lead" status="running" />);
    expect(screen.getByTitle("running")).toBeTruthy();
  });
});
