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
  "system-event",
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

  it("renders a distinct icon and label for system-event", () => {
    const { container } = render(<KindIcon kind="system-event" />);
    const path = container.querySelector("path")?.getAttribute("d");
    expect(path).toBeTruthy();
    expect(describeNode("system-event", 0)).toBe("System event");
  });

  it("describes a thread by its state and provider (BBP-206 R2c)", () => {
    expect(describeNode("thread", 0, { state: "idle", provider: "pi" })).toBe("idle · pi");
    expect(describeNode("thread", 0, { provider: "pi" })).toBe("pi");
    expect(describeNode("thread", 0, { state: "", provider: undefined })).toBe("Thread");
    expect(describeNode("thread", 0)).toBe("Thread");
  });

  it("describes a turn by its step count once its label is the first line", () => {
    expect(describeNode("turn", 0, { summaryCount: 9, firstLine: "Add dark mode" })).toBe("Turn · 9 steps");
    expect(describeNode("turn", 0, { summaryCount: 1, firstLine: "Hi" })).toBe("Turn · 1 step");
    // Not enriched yet: the label still reads "Turn · n steps", no repeat.
    expect(describeNode("turn", 0, { summaryCount: 9 })).toBe("Turn");
  });

  it("describes a tool call as a tool call", () => {
    expect(describeNode("tool-call", 0, { toolName: "Bash" })).toBe("Tool call");
  });

  it("names what a tool call did by its workKind, with diff, failed exit and duration", () => {
    expect(describeNode("tool-call", 0, { workKind: "command", exitCode: 0, duration: "400ms" })).toBe("Command · 400ms");
    expect(describeNode("tool-call", 0, { workKind: "command", exitCode: 1, duration: "800ms" })).toBe("Command · exit 1 · 800ms");
    expect(describeNode("tool-call", 0, { workKind: "file-change", changeKind: "update", diffStats: "+14 -0" })).toBe("Edit · +14 -0");
    expect(describeNode("tool-call", 0, { workKind: "file-change", changeKind: "create" })).toBe("New file");
    expect(describeNode("tool-call", 0, { workKind: "file-read", duration: "200ms" })).toBe("Read · 200ms");
    expect(describeNode("tool-call", 0, { workKind: "something-new" })).toBe("Tool call");
  });

  it("calls a message row a request or a reply", () => {
    expect(describeNode("turn", 0, { from: "User" })).toBe("Request");
    expect(describeNode("turn", 0, { from: "Agent" })).toBe("Reply");
  });

  it("describes a crew by how many of its members are actually active (BBP-214 feedback 1)", () => {
    expect(describeNode("crew", 10, { members: 10, active: 3 })).toBe("Crew · 3 of 10 active");
  });

  it("negative: a crew with every member idle reads '0 of n active', not 'n members'", () => {
    expect(describeNode("crew", 10, { members: 10, active: 0 })).toBe("Crew · 0 of 10 active");
  });

  it("falls back to the plain member count when the layer did not supply active/members meta", () => {
    expect(describeNode("crew", 10, {})).toBe("Crew · 10 members");
    expect(describeNode("crew", 1, {})).toBe("Crew · 1 member");
    expect(describeNode("crew", 0, {})).toBe("Crew");
  });
});
