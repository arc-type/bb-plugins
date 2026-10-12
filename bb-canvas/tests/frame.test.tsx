// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Frame } from "@/components/Frame";

afterEach(cleanup);

describe("Frame", () => {
  it("renders its label", () => {
    render(<Frame label="crew-a" x={0} y={0} width={100} height={100} />);
    expect(screen.getByText("crew-a")).toBeTruthy();
  });

  it("renders no label text when none is given", () => {
    const { container } = render(<Frame x={0} y={0} width={100} height={100} />);
    expect(container.textContent).toBe("");
  });

  it("positions and sizes the box from its props", () => {
    const { container } = render(<Frame label="crew-a" x={12} y={34} width={200} height={150} />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.left).toBe("12px");
    expect(box.style.top).toBe("34px");
    expect(box.style.width).toBe("200px");
    expect(box.style.height).toBe("150px");
  });

  it("has no interactive state of its own — a plain box, not a button", () => {
    const { container } = render(<Frame label="crew-a" x={0} y={0} width={100} height={100} />);
    expect(container.querySelector("button")).toBeNull();
  });
});
