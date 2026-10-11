// @vitest-environment jsdom
//
// Crew's own copy of the canvas page (BBP-131 WI4): shown only when
// `canvasPage` says Graph Studio is not active, otherwise a short note.
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
    { subPath: "" },
    {
      rpc: {
        canvasPage: () => ({ visible: true }),
        canvasLayer: () => ({
          contractVersion: 1,
          nodes: [
            {
              id: "member:a@crew",
              kind: "member",
              label: "a",
              parentId: "project:p1",
              meta: { threadId: "t1" },
            },
          ],
          edges: [],
          expanded: ["member:a@crew"],
        }),
        ...overrides.rpc,
      },
      context: { projectId: "p1", threadId: null },
      ...(overrides.sdk ? { sdk: overrides.sdk as never } : { sdk: { projects: { get: async () => ({ name: "Shop" }) } } as never }),
    },
  );
}

describe("crew's canvas page", () => {
  it("shows a note instead of the canvas while Graph Studio is active", async () => {
    canvasPanel({ rpc: { canvasPage: () => ({ visible: false }) } });
    expect(await screen.findByText("Graph Studio provides this page while it is installed.")).toBeTruthy();
  });

  it("shows the canvas, rooted under agents → project, when Graph Studio is absent", async () => {
    canvasPanel();
    expect(await screen.findByRole("button", { name: /^Agents — / })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp("^Shop — ") })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp("^a — ") })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp("^Thread — ") })).toBeTruthy();
  });

  it("loads a thread's timeline lazily, once its node is opened", async () => {
    const timeline = async () => ({ rows: [{ id: "r1", kind: "conversation", text: "Ship it" }] });
    canvasPanel({ sdk: { projects: { get: async () => ({ name: "Shop" }) }, threads: { timeline } } });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp("^Thread — ") }));
    fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "Enter" });
    expect(await screen.findByRole("button", { name: new RegExp("^Ship it — ") })).toBeTruthy();
  });

  it("falls back to visible when the canvasPage RPC itself fails", async () => {
    canvasPanel({ rpc: { canvasPage: () => Promise.reject(new Error("no route")) } });
    expect(await screen.findByRole("button", { name: /^Agents — / })).toBeTruthy();
  });
});
