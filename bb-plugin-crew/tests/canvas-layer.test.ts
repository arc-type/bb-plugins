import { describe, expect, it } from "vitest";
import { crewCanvasLayer, crewOwnsCanvasPage, memberNodeId } from "../lib/canvas-layer";
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
