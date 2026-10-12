import { describe, expect, it } from "vitest";
import { canvasExtensionDescribe, canvasExtensionLayer } from "../lib/canvas-extension";
import type { MemberInfo } from "../lib/contract";

const member = (over: Partial<MemberInfo>): MemberInfo => ({
  memberId: "m", address: "dev@trio", crew: "trio", key: "dev", groupId: "dev", lead: false, role: "",
  threadId: null, shift: null, activity: "idle", ...over,
});

describe("canvasExtensionDescribe (BBP-174 spike: canvasExtension.describe)", () => {
  it("declares one layer, deterministic id/label/icon, no input required", () => {
    expect(canvasExtensionDescribe()).toEqual({
      layers: [{ id: "crew", label: "Crew", icon: "users" }],
    });
  });
});

describe("canvasExtensionLayer (BBP-174 spike: canvasExtension.layer)", () => {
  it("wraps the existing crewCanvasLayer data with the contract version, for the requested scope's project", () => {
    const result = canvasExtensionLayer(
      { projectId: "p1" },
      [{ name: "trio", status: "running" }],
      [member({ address: "lead@trio", key: "lead", lead: true, activity: "working", threadId: "t1" })],
    );
    expect(result.contractVersion).toBe(1);
    expect(result.nodes.map((node) => node.id)).toEqual(["crew:trio", "member:lead@trio"]);
  });

  it("negative: a project with no crews yields an empty layer, not an error", () => {
    const result = canvasExtensionLayer({ projectId: "p1" }, [], []);
    expect(result).toEqual({ contractVersion: 1, nodes: [], edges: [], expanded: [], frames: [] });
  });
});
