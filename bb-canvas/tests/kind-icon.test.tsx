// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { KindIcon, describeNode } from "@/components/KindIcon";
import type { CanvasNodeKind } from "@/lib/types";

const ALL_KINDS: CanvasNodeKind[] = [
  "agents",
  "project",
  "crew",
  "member",
  "graph-run",
  "step",
  "thread",
  "turn",
  "tool-call",
  "subagent",
];

describe("KindIcon", () => {
  it("renders a subagent path distinct from every other kind", () => {
    const { container } = render(<KindIcon kind="subagent" />);
    const subagentPath = container.querySelector("path")?.getAttribute("d");
    const otherPaths = ALL_KINDS.filter((kind) => kind !== "subagent").map((kind) => {
      const { container } = render(<KindIcon kind={kind} />);
      return container.querySelector("path")?.getAttribute("d");
    });
    expect(otherPaths).not.toContain(subagentPath);
  });

  it("describes a subagent node by its label alone", () => {
    expect(describeNode("subagent", 0)).toBe("Subagent");
  });
});
