// The canvasLayer RPC end to end over the fake host: crew's layer is pulled
// in through plugins.callRpc, and a missing crew plugin must not break it.
import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import graphStudio from "../server";

const open: FakePluginHost[] = [];
afterEach(async () => {
  for (const host of open.splice(0)) await host.harness.lifecycle.dispose();
});

function load(callRpc: (args: { pluginId: string; method: string; outputSchema: { parse(v: unknown): unknown } }) => Promise<unknown>) {
  const host = createFakePluginHost({
    pluginId: "graph-studio",
    sdk: {
      plugins: { callRpc },
      projects: { get: async () => ({ id: "p1", name: "Shop", sources: [] }) },
    } as never,
  });
  open.push(host);
  graphStudio(host.bb);
  return host;
}

type Page = { crew: boolean; nodes: { id: string; kind: string; label: string }[]; expanded: string[] };

describe("canvasLayer RPC", () => {
  it("asks crew for its layer and roots it under agents → project", async () => {
    const asked: string[] = [];
    const host = load(async (args) => {
      asked.push(`${args.pluginId}.${args.method}`);
      return args.outputSchema.parse({
        contractVersion: 1,
        nodes: [{ id: "crew:trio", kind: "crew", label: "trio", parentId: "project:p1" }],
        edges: [],
        expanded: ["crew:trio"],
      });
    });
    const page = (await host.harness.behavior.callRpc("canvasLayer", { projectId: "p1" })) as Page;
    expect(asked).toEqual(["crew.canvasLayer"]);
    expect(page.crew).toBe(true);
    expect(page.nodes.map((node) => [node.id, node.label])).toEqual([["agents", "Agents"], ["project:p1", "Shop"], ["crew:trio", "trio"]]);
    expect(page.expanded).toEqual(["agents", "project:p1", "crew:trio"]);
  });

  it("negative: crew not installed → no crew level, no error", async () => {
    const host = load(async () => { throw new Error('No plugin "crew"'); });
    const page = (await host.harness.behavior.callRpc("canvasLayer", { projectId: "p1" })) as Page;
    expect(page.crew).toBe(false);
    expect(page.nodes.map((node) => node.kind)).toEqual(["agents", "project"]);
  });

  it("negative: crew speaking another contract version counts as missing", async () => {
    const host = load(async (args) => args.outputSchema.parse({ contractVersion: 2, nodes: [], edges: [], expanded: [] }));
    expect(((await host.harness.behavior.callRpc("canvasLayer", { projectId: "p1" })) as Page).crew).toBe(false);
  });
});
