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

function canvasPanel(
  overrides: { rpc?: Record<string, unknown>; sdk?: Record<string, unknown>; projectId?: string | null; subPath?: string } = {},
) {
  const panel = app.navPanels.find((entry) => entry.id === "canvas")!;
  return renderSlot(
    panel,
    { subPath: overrides.subPath ?? "" },
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
      context: { projectId: overrides.projectId === undefined ? "p1" : overrides.projectId, threadId: null },
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

  // BBP-173, measured in BB: on the nav-panel route `/plugins/<id>/canvas`
  // the host's context carries no projectId, even when opened from a project.
  it("takes the project from the subPath when the host context has none", async () => {
    canvasPanel({ projectId: null, subPath: "p1" });
    expect(await screen.findByRole("button", { name: new RegExp("^Shop — ") })).toBeTruthy();
  });

  it("negative: no project anywhere → a project picker that deep-links into the canvas, no empty page", async () => {
    const slot = canvasPanel({
      projectId: null,
      sdk: { projects: { list: async () => [{ id: "p1", name: "Shop" }, { id: "p2", name: "Blog" }], get: async () => ({ name: "Shop" }) } },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Blog" }));
    expect(slot.navigateCalls).toEqual([{ method: "toPluginPanel", path: "canvas", options: { subPath: "p2" } }]);
  });

  it("picker says it is loading until the project list arrives, then asks for a pick", async () => {
    let release: (list: { id: string; name: string }[]) => void = () => {};
    const pending = new Promise<{ id: string; name: string }[]>((resolve) => (release = resolve));
    canvasPanel({ projectId: null, sdk: { projects: { list: () => pending } } });
    expect(await screen.findByText("Loading projects…")).toBeTruthy();
    release([{ id: "p1", name: "Shop" }]);
    expect(await screen.findByText("Pick a project to see its canvas.")).toBeTruthy();
  });

  it("negative: an empty project list says so instead of an orphaned prompt", async () => {
    canvasPanel({ projectId: null, sdk: { projects: { list: async () => [] } } });
    expect(await screen.findByText("No projects yet.")).toBeTruthy();
    expect(screen.queryByText("Pick a project to see its canvas.")).toBeNull();
  });
});

describe("crew's canvas page frame/edit mode (BBP-170 WI6)", () => {
  function frameLayerPanel() {
    return canvasPanel({
      rpc: {
        canvasLayer: () => ({
          contractVersion: 1,
          nodes: [{ id: "member:lead@trio", kind: "member", label: "lead", parentId: "crew:trio", frameId: "frame:trio" }],
          edges: [],
          expanded: ["crew:trio"],
          frames: [{ id: "frame:trio", parentId: null, label: "trio" }],
        }),
        getCrewFile: () => ({ yaml: 'version: "1"\nname: trio\ngroups: []\n', version: 1 }),
      },
    });
  }

  it("E on a member card enters edit mode and shows the CrewFrameEditPanel instead of the sidebar", async () => {
    frameLayerPanel();
    const card = await screen.findByRole("button", { name: new RegExp("^lead — ") });
    fireEvent.click(card);
    fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "e" });
    expect(await screen.findByLabelText("Editing trio")).toBeTruthy();
    expect(screen.queryByLabelText("Details for lead")).toBeNull();
  });

  it("Escape leaves edit mode and brings the sidebar back", async () => {
    frameLayerPanel();
    const card = await screen.findByRole("button", { name: new RegExp("^lead — ") });
    fireEvent.click(card);
    const view = document.querySelector("[data-canvas-view]")!;
    fireEvent.keyDown(view, { key: "e" });
    await screen.findByLabelText("Editing trio");
    fireEvent.keyDown(view, { key: "Escape" });
    expect(screen.queryByLabelText("Editing trio")).toBeNull();
    expect(screen.getByLabelText("Details for lead")).toBeTruthy();
  });

  it("negative: an older canvasLayer response with no frames field still renders, with nothing editable", async () => {
    canvasPanel();
    const card = await screen.findByRole("button", { name: new RegExp("^a — ") });
    fireEvent.click(card);
    expect(() => fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "e" })).not.toThrow();
    expect(screen.queryByText(/^Editing /)).toBeNull();
  });
});
