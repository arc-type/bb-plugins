// @vitest-environment jsdom
//
// The canvas nav panel end to end through the SDK's own slot harness: the
// RPC call it makes, and the lazy timeline fetch behind a thread node.
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot, type CapturedPluginApp } from "@get-bb/plugin-sdk/testing/app";

let app: CapturedPluginApp;

beforeAll(async () => {
  app = await loadPluginApp(() => import("../app"));
});
afterEach(cleanup);

function canvasPanel(
  overrides: { rpc?: Record<string, unknown>; sdk?: Record<string, unknown>; projectId?: string | null; subPath?: string } = {},
) {
  const panel = app.navPanels.find((entry) => entry.id === "canvas")!;
  return renderSlot(
    panel,
    { subPath: overrides.subPath ?? "" },
    {
      rpc: {
        canvasLayer: () => ({
          contractVersion: 1,
          crew: true,
          nodes: [
            { id: "agents", kind: "agents", label: "Agents", parentId: null },
            { id: "project:p1", kind: "project", label: "Shop", parentId: "agents" },
            {
              id: "member:a@crew",
              kind: "member",
              label: "a",
              parentId: "project:p1",
              meta: { threadId: "t1" },
            },
          ],
          edges: [],
          expanded: ["agents", "project:p1", "member:a@crew"],
        }),
        ...overrides.rpc,
      },
      context: { projectId: overrides.projectId === undefined ? "p1" : overrides.projectId, threadId: null },
      ...(overrides.sdk ? { sdk: overrides.sdk as never } : {}),
    },
  );
}

describe("the canvas page", () => {
  it("renders the nodes from canvasLayer, with a thread node under the member", async () => {
    canvasPanel();
    expect(await screen.findByRole("button", { name: new RegExp("^Shop — ") })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp("^a — ") })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp("^Thread — ") })).toBeTruthy();
  });

  it("loads the thread's timeline lazily, once its node is opened", async () => {
    const timeline = () => ({
      rows: [{ id: "r1", kind: "conversation", text: "Please fix the bug" }],
    });
    canvasPanel({ sdk: { threads: { timeline } } });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp("^Thread — ") }));
    fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "Enter" });
    expect(await screen.findByRole("button", { name: new RegExp("^Please fix the bug — ") })).toBeTruthy();
  });

  // BBP-173, measured in BB: on the nav-panel route `/plugins/<id>/canvas`
  // the host's context carries no projectId, even when opened from a project.
  it("takes the project from the subPath when the host context has none", async () => {
    canvasPanel({ projectId: null, subPath: "p1" });
    expect(await screen.findByRole("button", { name: new RegExp("^Shop — ") })).toBeTruthy();
  });

  it("negative: no project anywhere → a project picker that deep-links into the canvas, no empty page", async () => {
    const slot = canvasPanel({
      projectId: null,
      sdk: { projects: { list: async () => [{ id: "p1", name: "Shop" }, { id: "p2", name: "Blog" }] } },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Blog" }));
    expect(slot.navigateCalls).toEqual([{ method: "toPluginPanel", path: "canvas", options: { subPath: "p2" } }]);
  });
});
