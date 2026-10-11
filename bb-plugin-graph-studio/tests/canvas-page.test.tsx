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

function canvasPanel(overrides: { rpc?: Record<string, unknown>; sdk?: Record<string, unknown> } = {}) {
  const panel = app.navPanels.find((entry) => entry.id === "canvas")!;
  return renderSlot(
    panel,
    {},
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
      context: { projectId: "p1", threadId: null },
      ...(overrides.sdk ? { sdk: overrides.sdk as never } : {}),
    },
  );
}

describe("the canvas page", () => {
  it("renders the nodes from canvasLayer, with a thread node under the member", async () => {
    canvasPanel();
    expect(await screen.findByRole("button", { name: "Shop — project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "a — member" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Thread — thread" })).toBeTruthy();
  });

  it("loads the thread's timeline lazily, once its node is opened", async () => {
    const timeline = () => ({
      rows: [{ id: "r1", kind: "conversation", text: "Please fix the bug" }],
    });
    canvasPanel({ sdk: { threads: { timeline } } });
    fireEvent.click(await screen.findByRole("button", { name: "Thread — thread" }));
    fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "Enter" });
    expect(await screen.findByRole("button", { name: "Please fix the bug — turn" })).toBeTruthy();
  });

  it("shows a message instead of a canvas when no project is open", () => {
    const panel = app.navPanels.find((entry) => entry.id === "canvas")!;
    renderSlot(panel, {}, { rpc: { canvasLayer: () => ({ crew: true, nodes: [], edges: [], expanded: [] }) }, context: { projectId: null, threadId: null } });
    expect(screen.getByText("Open a project to see its canvas.")).toBeTruthy();
  });
});
