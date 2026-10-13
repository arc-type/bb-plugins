// @vitest-environment jsdom
//
// BBP-179: crew has no nav entry for its canvas (Graph Studio owns
// "Activity Canvas"), so the Crews header carries the way in — but only
// while crew's own canvas is the one that shows anything.
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot, type CapturedPluginApp } from "@get-bb/plugin-sdk/testing/app";
import pluginApp from "../app";

let app: CapturedPluginApp;

beforeAll(async () => {
  app = await loadPluginApp(pluginApp);
});
afterEach(cleanup);

function header(canvasPage: () => unknown) {
  const panel = app.navPanels.find((entry) => entry.id === "crews")!;
  return renderSlot({ ...panel, component: panel.headerContent! }, { subPath: "" }, {
    rpc: { canvasPage, needsYou: () => ({ errors: 0, decisions: 0 }), listCrews: () => ({ crews: [] }) },
  });
}

describe("Activity canvas entry in the Crews header", () => {
  it("opens crews/canvas while Graph Studio is absent", async () => {
    const slot = header(() => ({ visible: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Activity canvas" }));
    expect(slot.navigateCalls).toEqual([{ method: "toPluginPanel", path: "crews", options: { subPath: "canvas" } }]);
  });

  it("negative: hidden while Graph Studio owns the canvas", async () => {
    header(() => ({ visible: false }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: "Activity canvas" })).toBeNull();
  });

  it("shows when the canvasPage RPC fails, as the page itself does", async () => {
    header(() => Promise.reject(new Error("no route")));
    expect(await screen.findByRole("button", { name: "Activity canvas" })).toBeTruthy();
  });
});
