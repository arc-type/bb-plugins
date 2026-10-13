import { describe, expect, it } from "vitest";
import { formatContextShare, formatDrift } from "../lib/format";

describe("formatContextShare", () => {
  it("rounds a 0..1 share to a whole percent (BBP-96: 0.084573 read as 8%, not 0.084573%)", () => {
    expect(formatContextShare(0.084573)).toBe("8%");
  });

  it("rounds down below the half-point", () => {
    expect(formatContextShare(0.004)).toBe("0%");
  });

  it("rounds up at the half-point", () => {
    expect(formatContextShare(0.005)).toBe("1%");
  });

  it("handles the empty and full ends", () => {
    expect(formatContextShare(0)).toBe("0%");
    expect(formatContextShare(1)).toBe("100%");
  });
});

describe("formatDrift (BBP-248)", () => {
  const m = (key: string, model: string, provider = "claude-code") => ({ key, provider, model });
  it("no drift: says none and names the stored file version", () => {
    expect(formatDrift([m("a", "opus")], [m("a", "opus")], 8)).toBe("Drift from file: none; stored file v8");
  });
  it("members the instance has beyond the file are +, members it lacks are −", () => {
    expect(formatDrift([m("a", "opus"), m("steps-steps-impl3", "opus")], [m("a", "opus"), m("b", "opus")], 10)).toBe(
      "Drift from file: +members steps-steps-impl3, −members b; stored file v10",
    );
  });
  it("a model change names the member with instance → file; a provider change shows provider/model", () => {
    expect(formatDrift([m("a", "opus"), m("b", "gpt-5", "codex")], [m("a", "sonnet"), m("b", "sonnet")], 3)).toBe(
      "Drift from file: models a (opus→sonnet), b (codex/gpt-5→claude-code/sonnet); stored file v3",
    );
  });
});
