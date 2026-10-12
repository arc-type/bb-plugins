// @vitest-environment jsdom
//
// The canvas nav panel end to end through the SDK's own slot harness: the
// RPC call it makes, and the lazy timeline fetch behind a thread node.
import { cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot, type CapturedPluginApp } from "@get-bb/plugin-sdk/testing/app";

let app: CapturedPluginApp;

beforeAll(async () => {
  app = await loadPluginApp(() => import("../app"));
});
beforeEach(() => localStorage.clear());
afterEach(cleanup);

const LABELS: Record<string, string> = { p1: "Shop", p2: "Blog" };

/** What the server hands back per project: already rooted under `agents`. */
function layerFor(projectId: string) {
  return {
    contractVersion: 1,
    crew: true,
    nodes: [
      { id: "agents", kind: "agents", label: "Agents", parentId: null },
      { id: `project:${projectId}`, kind: "project", label: LABELS[projectId] ?? projectId, parentId: "agents" },
      ...(projectId === "p1"
        ? [{ id: "member:a@crew", kind: "member", label: "a", parentId: "project:p1", meta: { threadId: "t1" } }]
        : []),
    ],
    edges: [],
    expanded: ["agents", `project:${projectId}`, "member:a@crew"],
  };
}

const TWO_PROJECTS = { projects: { list: async () => [{ id: "p1", name: "Shop" }, { id: "p2", name: "Blog" }] } };

function canvasPanel(
  overrides: { rpc?: Record<string, unknown>; sdk?: Record<string, unknown>; projectId?: string | null; subPath?: string } = {},
) {
  const panel = app.navPanels.find((entry) => entry.id === "canvas")!;
  return renderSlot(
    panel,
    { subPath: overrides.subPath ?? "" },
    {
      rpc: {
        canvasLayer: ({ projectId }: { projectId: string }) => layerFor(projectId),
        ...overrides.rpc,
      },
      context: { projectId: overrides.projectId === undefined ? "p1" : overrides.projectId, threadId: null },
      sdk: { projects: { list: async () => [{ id: "p1", name: "Shop" }] }, ...overrides.sdk } as never,
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

  // BBP-179 acceptance regression: a real SDK timeline response nests a
  // turn's work rows under `children`, and a delegation (subagent) row
  // nests its own rows under `childRows` — not the shallow
  // `{kind:"conversation"}` fixture the test above uses. "Expand all"
  // deliberately never fetches this; a thread must be opened individually.
  it("shows a turn, a tool-call, and a nested subagent once a real-shaped timeline loads", async () => {
    const timeline = () => ({
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
    canvasPanel({ sdk: { threads: { timeline } } });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp("^Thread — ") }));
    fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "Enter" });
    const turnCard = await screen.findByRole("button", { name: new RegExp("^Turn · 2 steps") });
    fireEvent.click(turnCard);
    fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "Enter" });
    expect(screen.getByRole("button", { name: new RegExp("^Bash") })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp("^Agent: research the bug") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp("^Read") })).toBeNull();
  });

  // BBP-173, measured in BB: on the nav-panel route `/plugins/<id>/canvas`
  // the host's context carries no projectId, even when opened from a project.
  it("takes the project from the subPath when the host context has none", async () => {
    canvasPanel({ projectId: null, subPath: "p1" });
    expect(await screen.findByRole("button", { name: new RegExp("^Shop — ") })).toBeTruthy();
  });

  it("negative: no project anywhere → every project as a root side by side, no picker dead-end", async () => {
    canvasPanel({ projectId: null, sdk: TWO_PROJECTS });
    expect(await screen.findByRole("button", { name: new RegExp("^Shop — ") })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp("^Blog — ") })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Agents — / })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Projects: All/ })).toBeTruthy();
  });

  it("the project filter narrows the roots and survives a reload", async () => {
    canvasPanel({ projectId: null, sdk: TWO_PROJECTS });
    await screen.findByRole("button", { name: new RegExp("^Blog — ") });
    fireEvent.click(screen.getByRole("button", { name: /Projects:/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Blog" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: new RegExp("^Shop — ") })).toBeNull());
    expect(await screen.findByRole("button", { name: new RegExp("^Blog — ") })).toBeTruthy();
    cleanup();
    canvasPanel({ projectId: null, sdk: TWO_PROJECTS });
    expect(await screen.findByRole("button", { name: /Projects: Blog/ })).toBeTruthy();
    expect(await screen.findByRole("button", { name: new RegExp("^Blog — ") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp("^Shop — ") })).toBeNull();
  });

  it("negative: a stored id of a deleted project is ignored, every project shows", async () => {
    localStorage.setItem("bb-canvas:project-filter", '["gone"]');
    canvasPanel({ projectId: null, sdk: TWO_PROJECTS });
    expect(await screen.findByRole("button", { name: new RegExp("^Shop — ") })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp("^Blog — ") })).toBeTruthy();
  });

  it("a subPath project pre-selects that project", async () => {
    localStorage.setItem("bb-canvas:project-filter", '["p1"]');
    canvasPanel({ projectId: null, subPath: "p2", sdk: TWO_PROJECTS });
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
    canvasPanel({ sdk: { projects: { list: async () => Promise.reject(new Error("offline")) } } });
    expect(await screen.findByRole("button", { name: new RegExp("^Shop — ") })).toBeTruthy();
  });

  it("negative: an empty project list says so instead of an empty canvas", async () => {
    canvasPanel({ projectId: null, sdk: { projects: { list: async () => [] } } });
    expect(await screen.findByText("No projects yet.")).toBeTruthy();
  });
});
