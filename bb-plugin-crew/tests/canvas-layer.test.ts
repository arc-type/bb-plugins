import { describe, expect, it } from "vitest";
import { crewCanvasLayer, crewOwnsCanvasPage, crewTopologyFrame, memberNodeId } from "../lib/canvas-layer";
import type { MemberInfo } from "../lib/contract";

const member = (over: Partial<MemberInfo>): MemberInfo => ({
  memberId: "m", address: "dev@trio", crew: "trio", key: "dev", lead: false, role: "",
  threadId: null, shift: null, activity: "idle", ...over,
});

describe("crewCanvasLayer", () => {
  it("hangs crews under the project and members under their crew, crews expanded", () => {
    const layer = crewCanvasLayer("p1", [{ name: "trio", status: "running" }], [
      member({ address: "lead@trio", key: "lead", lead: true, activity: "working", threadId: "t1", role: "Leads" }),
      member({ address: "dev@trio", key: "dev", activity: "needs-you" }),
    ]);
    expect(layer.nodes).toEqual([
      { id: "crew:trio", kind: "crew", label: "trio", status: "running", parentId: "project:p1", meta: { crew: "trio", status: "running" } },
      { id: "member:lead@trio", kind: "member", label: "lead", status: "running", parentId: "crew:trio",
        meta: { address: "lead@trio", role: "Leads", lead: true, threadId: "t1", activity: "working" } },
      { id: "member:dev@trio", kind: "member", label: "dev", status: "waiting", parentId: "crew:trio",
        meta: { address: "dev@trio", role: "", lead: false, threadId: null, activity: "needs-you" } },
    ]);
    expect(layer.expanded).toEqual(["crew:trio"]);
    expect(layer.edges).toEqual([]);
    expect(memberNodeId("dev@trio")).toBe("member:dev@trio");
  });

  it("negative: no crews → empty layer; unknown activity → no status; stopped crew is not expanded", () => {
    expect(crewCanvasLayer("p1", [], [])).toEqual({ nodes: [], edges: [], expanded: [] });
    const layer = crewCanvasLayer("p1", [{ name: "old", status: "stopped" }], [member({ crew: "old", address: "a@old", activity: "unknown" })]);
    expect(layer.nodes[1]!.status).toBeUndefined();
    expect(layer.expanded).toEqual([]);
  });

  describe("links (BBP-170)", () => {
    const trio = [
      member({ address: "lead@trio", key: "lead", lead: true }),
      member({ address: "dev@trio", key: "dev" }),
    ];

    it("turns a crew's declared links into message edges between its member nodes", () => {
      const layer = crewCanvasLayer("p1", [{ name: "trio", status: "running" }], trio, {
        trio: [{ from: "lead", to: "dev", kind: "assigns_to" }],
      });
      expect(layer.edges).toEqual([{ from: "member:lead@trio", to: "member:dev@trio", variant: "message", label: "assigns_to" }]);
    });

    it("negative: a link naming an unknown member, or a crew with no links entry, yields no edge", () => {
      const layer = crewCanvasLayer("p1", [{ name: "trio", status: "running" }], trio, {
        trio: [{ from: "lead", to: "ghost", kind: "assigns_to" }],
      });
      expect(layer.edges).toEqual([]);
      expect(crewCanvasLayer("p1", [{ name: "trio", status: "running" }], trio).edges).toEqual([]);
    });
  });
});

describe("crewOwnsCanvasPage", () => {
  const gs = (over: Partial<{ enabled: boolean; status: string }> = {}) => ({ id: "graph-studio", enabled: true, status: "running", ...over });
  it("shows the page only while graph-studio is not active", () => {
    expect(crewOwnsCanvasPage([])).toBe(true);
    expect(crewOwnsCanvasPage([{ id: "crew", enabled: true, status: "running" }])).toBe(true);
    expect(crewOwnsCanvasPage([gs({ enabled: false })])).toBe(true);
    expect(crewOwnsCanvasPage([gs({ status: "error" })])).toBe(true);
  });
  it("negative: an active graph-studio wins, the crew page stays hidden", () => {
    expect(crewOwnsCanvasPage([gs()])).toBe(false);
    expect(crewOwnsCanvasPage([gs({ status: "starting" })])).toBe(false);
  });
});

describe("canvasLayer / canvasPage RPC", () => {
  it("serves the crew layer with contractVersion and tells whether crew owns the page", async () => {
    const { createFakePluginHost } = await import("@get-bb/plugin-sdk/testing");
    const { default: plugin } = await import("../server");
    const { bb, harness } = createFakePluginHost({ pluginId: "crew" });
    let plugins: { id: string; enabled: boolean; status: string }[] = [];
    harness.sdk.stub("plugins.list", async () => ({ plugins }) as never);
    await plugin(bb);
    expect(await harness.behavior.callRpc("canvasLayer", { projectId: "p1" })).toEqual({ contractVersion: 1, nodes: [], edges: [], expanded: [] });
    expect(await harness.behavior.callRpc("canvasPage", {})).toEqual({ visible: true });
    plugins = [{ id: "graph-studio", enabled: true, status: "running" }];
    expect(await harness.behavior.callRpc("canvasPage", {})).toEqual({ visible: false });
    await harness.lifecycle.dispose();
  });

  it("negative: plugins.list failing keeps the page visible rather than hiding the canvas everywhere", async () => {
    const { createFakePluginHost } = await import("@get-bb/plugin-sdk/testing");
    const { default: plugin } = await import("../server");
    const { bb, harness } = createFakePluginHost({ pluginId: "crew" });
    harness.sdk.stub("plugins.list", async () => { throw new Error("down"); });
    await plugin(bb);
    expect(await harness.behavior.callRpc("canvasPage", {})).toEqual({ visible: true });
    await harness.lifecycle.dispose();
  });
});

describe("crewTopologyFrame", () => {
  // Shaped like a crew.yaml: lead in group "orch", two devs in "dev", links between them.
  const members = [
    { key: "dev-a", groupId: "dev", lead: false },
    { key: "lead", groupId: "orch", lead: true },
    { key: "dev-b", groupId: "dev", lead: false },
  ];
  const links = [
    { from: "lead", to: "dev-a", kind: "assigns_to" },
    { from: "dev-a", to: "dev-b", kind: "works_with" },
    { from: "dev-b", to: "lead", kind: "escalates_to" },
  ];

  it("frames the crew, orders lead first then groups, members carry the frame id", () => {
    const topo = crewTopologyFrame("trio", members, links);
    expect(topo.frames).toEqual([{ id: "frame:trio", parentId: null, label: "trio" }]);
    expect(topo.nodes.map((node) => node.id)).toEqual(["member:lead@trio", "member:dev-a@trio", "member:dev-b@trio"]);
    expect(topo.nodes.every((node) => node.frameId === "frame:trio" && node.kind === "member")).toBe(true);
    expect(topo.nodes[0]).toMatchObject({ label: "lead", parentId: null, meta: { lead: true, groupId: "orch", layer: 0 } });
    expect(topo.nodes[1]!.meta).toMatchObject({ layer: 1, groupId: "dev" });
  });

  it("turns links into edges, the shape from pathBetween picking flow or back", () => {
    const topo = crewTopologyFrame("trio", members, links);
    expect(topo.edges).toEqual([
      { from: "member:lead@trio", to: "member:dev-a@trio", variant: "flow", label: "assigns_to" },
      { from: "member:dev-a@trio", to: "member:dev-b@trio", variant: "flow", label: "works_with" },
      { from: "member:dev-b@trio", to: "member:lead@trio", variant: "back", label: "escalates_to" },
    ]);
  });

  it("negative: links to unknown members or to self are dropped; empty crew still yields its frame", () => {
    const topo = crewTopologyFrame("trio", members, [
      { from: "lead", to: "ghost", kind: "assigns_to" },
      { from: "lead", to: "lead", kind: "works_with" },
    ]);
    expect(topo.edges).toEqual([]);
    expect(crewTopologyFrame("empty", [], [])).toEqual({ frames: [{ id: "frame:empty", parentId: null, label: "empty" }], nodes: [], edges: [] });
  });
});
