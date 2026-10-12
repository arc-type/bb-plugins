// @vitest-environment jsdom
//
// Crew's own copy of the canvas page (BBP-131 WI4): shown only when
// `canvasPage` says Graph Studio is not active, otherwise a short note.
import { cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot, type CapturedPluginApp } from "@get-bb/plugin-sdk/testing/app";

let app: CapturedPluginApp;

beforeAll(async () => {
  app = await loadPluginApp(() => import("../app"));
});
beforeEach(() => localStorage.clear());
afterEach(cleanup);

function canvasPanel(
  overrides: { rpc?: Record<string, unknown>; sdk?: Record<string, unknown>; projectId?: string | null; subPath?: string } = {},
) {
  // BBP-179: no nav entry of its own any more — the Crews panel serves the
  // canvas under the `canvas` sub path.
  const panel = app.navPanels.find((entry) => entry.id === "crews")!;
  return renderSlot(
    panel,
    { subPath: overrides.subPath ? `canvas/${overrides.subPath}` : "canvas" },
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
      ...(overrides.sdk ? { sdk: overrides.sdk as never } : { sdk: { projects: { list: async () => [{ id: "p1", name: "Shop" }], get: async () => ({ name: "Shop" }) } } as never }),
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
    canvasPanel({ sdk: { projects: { list: async () => [{ id: "p1", name: "Shop" }] }, threads: { timeline } } });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp("^Thread — ") }));
    fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "Enter" });
    expect(await screen.findByRole("button", { name: new RegExp("^Ship it — ") })).toBeTruthy();
  });

  // BBP-179 acceptance regression: a real SDK timeline response nests a
  // turn's work rows under `children`, and a delegation (subagent) row
  // nests its own rows under `childRows` — not the shallow
  // `{kind:"conversation"}` fixture the earlier test above uses. "Expand
  // all" deliberately never fetches this (see expand-collapse.test.tsx); a
  // thread must be opened individually to load it.
  it("shows a turn, a tool-call, and a nested subagent once a real-shaped timeline loads", async () => {
    const timeline = async () => ({
      rows: [
        {
          id: "turn-1",
          kind: "turn",
          turnId: "turn-1",
          status: "completed",
          summaryCount: 2,
          completedAt: 1700000000000,
          children: [
            {
              id: "tool-1",
              kind: "work",
              workKind: "tool",
              toolName: "Bash",
              status: "completed",
              callId: "call-1",
              output: "3 files",
            },
            {
              id: "deleg-1",
              kind: "work",
              workKind: "delegation",
              toolName: "Task",
              status: "completed",
              callId: "call-2",
              description: "research the bug",
              output: "found it",
              childRows: [
                { id: "tool-2", kind: "work", workKind: "tool", toolName: "Read", status: "completed", callId: "call-3" },
              ],
            },
          ],
        },
      ],
    });
    canvasPanel({ sdk: { projects: { list: async () => [{ id: "p1", name: "Shop" }] }, threads: { timeline } } });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp("^Thread — ") }));
    fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "Enter" });
    const turnCard = await screen.findByRole("button", { name: new RegExp("^Turn · 2 steps") });
    fireEvent.click(turnCard);
    fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "Enter" });
    expect(screen.getByRole("button", { name: new RegExp("^Bash") })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp("^Agent: research the bug") })).toBeTruthy();
    // The subagent's own child stays hidden until the subagent card itself
    // is expanded — it must not be flattened straight into the turn.
    expect(screen.queryByRole("button", { name: new RegExp("^Read") })).toBeNull();
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

  it("negative: no project anywhere → every project as a root side by side, no picker dead-end", async () => {
    const asked: string[] = [];
    canvasPanel({
      projectId: null,
      rpc: {
        canvasLayer: ({ projectId }: { projectId: string }) => {
          asked.push(projectId);
          return { contractVersion: 1, nodes: [], edges: [], expanded: [] };
        },
      },
      sdk: { projects: { list: async () => [{ id: "p1", name: "Shop" }, { id: "p2", name: "Blog" }] } },
    });
    expect(await screen.findByRole("button", { name: new RegExp("^Shop — ") })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp("^Blog — ") })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Projects: All/ })).toBeTruthy();
    expect(asked.sort()).toEqual(["p1", "p2"]);
  });

  it("the project filter narrows the roots and survives a reload", async () => {
    const sdk = { projects: { list: async () => [{ id: "p1", name: "Shop" }, { id: "p2", name: "Blog" }] } };
    canvasPanel({ projectId: null, sdk });
    await screen.findByRole("button", { name: new RegExp("^Blog — ") });
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Blog" }));
    expect(await screen.findByRole("button", { name: /Projects: Blog/ })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: new RegExp("^Shop — ") })).toBeNull());
    expect(screen.getByRole("button", { name: new RegExp("^Blog — ") })).toBeTruthy();
    cleanup();
    canvasPanel({ projectId: null, sdk });
    expect(await screen.findByRole("button", { name: /Projects: Blog/ })).toBeTruthy();
    expect(await screen.findByRole("button", { name: new RegExp("^Blog — ") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp("^Shop — ") })).toBeNull();
  });

  it("negative: a stored id of a deleted project is ignored, every project shows", async () => {
    localStorage.setItem("bb-canvas:project-filter", '["gone"]');
    canvasPanel({ projectId: null, sdk: { projects: { list: async () => [{ id: "p1", name: "Shop" }, { id: "p2", name: "Blog" }] } } });
    expect(await screen.findByRole("button", { name: new RegExp("^Shop — ") })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp("^Blog — ") })).toBeTruthy();
  });

  it("a subPath project pre-selects that project", async () => {
    localStorage.setItem("bb-canvas:project-filter", '["p1"]');
    canvasPanel({ projectId: null, subPath: "p2", sdk: { projects: { list: async () => [{ id: "p1", name: "Shop" }, { id: "p2", name: "Blog" }] } } });
    expect(await screen.findByRole("button", { name: /Projects: Blog/ })).toBeTruthy();
    expect(await screen.findByRole("button", { name: new RegExp("^Blog — ") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp("^Shop — ") })).toBeNull();
  });

  it("says it is loading until the project list arrives", async () => {
    let release: (list: { id: string; name: string }[]) => void = () => {};
    const pending = new Promise<{ id: string; name: string }[]>((resolve) => (release = resolve));
    canvasPanel({ projectId: null, sdk: { projects: { list: () => pending } } });
    expect(await screen.findByText("Loading projects…")).toBeTruthy();
    release([{ id: "p1", name: "Shop" }]);
    expect(await screen.findByRole("button", { name: new RegExp("^Shop — ") })).toBeTruthy();
  });

  it("negative: a failing project list still shows the project the page was opened for", async () => {
    canvasPanel({ sdk: { projects: { list: async () => Promise.reject(new Error("offline")), get: async () => ({ name: "Shop" }) } } });
    expect(await screen.findByRole("button", { name: new RegExp("^Shop — ") })).toBeTruthy();
  });

  it("negative: an empty project list says so instead of an empty canvas", async () => {
    canvasPanel({ projectId: null, sdk: { projects: { list: async () => [] } } });
    expect(await screen.findByText("No projects yet.")).toBeTruthy();
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
