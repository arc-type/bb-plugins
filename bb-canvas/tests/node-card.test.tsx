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

describe("NodeCard status border (BBP-146)", () => {
  it("draws a solid destructive border when failed", () => {
    render(<NodeCard label="x" status="failed" />);
    const border = screen.getByRole("button").style.border;
    expect(border).toContain("solid");
    expect(border).toContain("var(--destructive)");
  });

  it("draws a dashed amber border when waiting", () => {
    render(<NodeCard label="x" status="waiting" />);
    expect(screen.getByRole("button").style.border).toContain("dashed");
  });

  it("draws a solid amber border when escalated", () => {
    const { container } = render(<NodeCard label="x" status="escalated" />);
    const button = container.querySelector("button")!;
    expect(button.style.border).not.toContain("dashed");
    expect(button.style.border).toContain("solid");
  });

  it("pulses while running", () => {
    render(<NodeCard label="x" status="running" />);
    expect(screen.getByRole("button").className).toContain("bb-canvas-pulse");
  });

  it("does not pulse when idle or done", () => {
    render(<NodeCard label="x" status="done" />);
    expect(screen.getByRole("button").className).not.toContain("bb-canvas-pulse");
  });

  it("stays neutral by default even with a kind, in status colour mode", () => {
    render(<NodeCard label="x" kind="member" />);
    expect(screen.getByRole("button").style.border).toContain("var(--border)");
  });

  it("tints a neutral card by kind in type colour mode", () => {
    render(<NodeCard label="x" kind="member" colorMode="type" />);
    expect(screen.getByRole("button").style.border).not.toContain("var(--border)");
  });

  it("keeps the error border even in type colour mode — status always wins", () => {
    render(<NodeCard label="x" kind="member" status="failed" colorMode="type" />);
    expect(screen.getByRole("button").style.border).toContain("var(--destructive)");
  });

  it("injects its keyframes once, no matter how many cards render", () => {
    render(
      <>
        <NodeCard label="a" status="running" />
        <NodeCard label="b" status="running" />
      </>,
    );
    expect(document.querySelectorAll("#bb-canvas-node-card-styles")).toHaveLength(1);
  });
});
