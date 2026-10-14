// Generated graphs (tag `dynamic`) stay out of every listing of the library —
// the CLI, the agent tools, the "#" mention, the picker — unless asked for,
// and stay fully reachable by id: a compiled run must still start, render and
// resume. Untagged graphs are listed exactly as before.
import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import graphStudio from "../server";
import { describeLibrary } from "../lib/describe";
import { graphSchema, isDynamic, type Graph } from "../lib/graph";
import { groupedLibrary, searchGraphs } from "../lib/templates";

const make = (id: string, tags: string[] = []): Graph =>
  graphSchema.parse({
    id,
    name: `Graph ${id}`,
    tags,
    nodes: [{ id: "a", label: "A", prompt: "{{input}}" }],
    edges: [
      { from: "__start__", to: "a" },
      { from: "a", to: "__end__" },
    ],
  });

const mine = make("my-flow");
const generated = make("td-demo-1", ["dynamic", "ticket:demo-1"]);

describe("listing the library", () => {
  it("leaves generated graphs out by default and keeps untagged ones", () => {
    expect(searchGraphs([mine, generated], "").map((graph) => graph.id)).toEqual(["my-flow"]);
    expect(searchGraphs([mine, generated], "graph").map((graph) => graph.id)).toEqual(["my-flow"]);
  });

  it("lists them when asked, and finds them by tag", () => {
    expect(searchGraphs([mine, generated], "", { generated: true }).map((graph) => graph.id)).toEqual([
      "my-flow",
      "td-demo-1",
    ]);
    expect(searchGraphs([mine, generated], "ticket:demo-1", { generated: true }).map((graph) => graph.id)).toEqual([
      "td-demo-1",
    ]);
  });

  it("puts them in a section of their own, never among the user's graphs", () => {
    const sections = groupedLibrary([mine, generated]);
    expect(sections.map((section) => [section.key, section.graphs.map((graph) => graph.id)])).toEqual([
      ["own", ["my-flow"]],
      ["generated", ["td-demo-1"]],
    ]);
    expect(describeLibrary([mine, generated])).toMatch(/Your graphs\n {2}my-flow[\s\S]*Generated\n {2}td-demo-1/);
  });

  it("reads a graph without tags as not generated", () => {
    expect(isDynamic({ tags: undefined as unknown as string[] })).toBe(false);
    expect(isDynamic(generated)).toBe(true);
  });
});

const open: FakePluginHost[] = [];
afterEach(async () => {
  for (const host of open.splice(0)) await host.harness.lifecycle.dispose();
});

async function loaded() {
  const host = createFakePluginHost({ pluginId: "graph-studio" });
  open.push(host);
  graphStudio(host.bb);
  for (const graph of [mine, generated]) {
    await host.harness.behavior.callRpc("importGraph", {
      json: JSON.stringify({ version: 1, graph }),
      overwrite: false,
    });
  }
  return host;
}

describe("the plugin's listings", () => {
  it("bb graph-studio graphs hides generated graphs, says so, and --all shows them", async () => {
    const host = await loaded();
    const plain = await host.harness.behavior.runCli(["graphs"]);
    expect(plain.stdout).toContain("my-flow");
    expect(plain.stdout).not.toContain("td-demo-1");
    expect(plain.stdout).toContain("1 generated graph not listed; add --all to see them.");
    const all = await host.harness.behavior.runCli(["graphs", "--all"]);
    expect(all.stdout).toMatch(/Generated\n {2}td-demo-1/);
    expect(all.stdout).not.toContain("not listed");
    const searched = await host.harness.behavior.runCli(["graphs", "demo", "--all"]);
    expect(searched.stdout).toContain("td-demo-1");
  });

  it("graph_studio_graphs leaves them out unless includeGenerated is set", async () => {
    const host = await loaded();
    const plain = await host.harness.behavior.callAgentTool("graph_studio_graphs", {});
    expect(JSON.stringify(plain)).not.toContain("td-demo-1");
    expect(JSON.stringify(plain)).toContain("my-flow");
    const all = await host.harness.behavior.callAgentTool("graph_studio_graphs", { includeGenerated: true });
    expect(JSON.stringify(all)).toContain("td-demo-1");
  });

  it("the # mention does not offer them, but resolves one by id", async () => {
    const host = await loaded();
    const provider = host.harness.inspection.registrations.mentionProviders.find((entry) => entry.id === "graphs")!;
    const items = await provider.search({ query: "" } as never);
    expect(items.map((item) => item.id)).toContain("my-flow");
    expect(items.map((item) => item.id)).not.toContain("td-demo-1");
    const resolved = await provider.resolve("td-demo-1", {} as never);
    expect(JSON.stringify(resolved)).toContain('graph \\"td-demo-1\\"');
  });

  it("still resolves a generated graph by id: show, export, getGraph, and the panel's library", async () => {
    const host = await loaded();
    expect((await host.harness.behavior.runCli(["show", "td-demo-1"])).stdout).toContain("Graph td-demo-1 (td-demo-1)");
    expect((await host.harness.behavior.runCli(["export", "td-demo-1"])).stdout).toContain('"dynamic"');
    const got = (await host.harness.behavior.callRpc("getGraph", { id: "td-demo-1" })) as { graph: Graph };
    expect(got.graph.tags).toEqual(["dynamic", "ticket:demo-1"]);
    // The panel gets the whole library — it needs generated graphs to draw a
    // run's subgraphs — and filters the listing itself.
    const library = (await host.harness.behavior.callRpc("listGraphs", null)) as { graphs: Graph[] };
    expect(library.graphs.map((graph) => graph.id)).toContain("td-demo-1");
  });
});
