// @vitest-environment jsdom
//
// The Canvas nav page (BBP-189 AK 1): Agents → projects → every thread BB
// lists, with no crew or Graph Studio RPC anywhere in the way.
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot, type CapturedPluginApp } from "@get-bb/plugin-sdk/testing/app";

let app: CapturedPluginApp;

beforeAll(async () => {
  app = await loadPluginApp(() => import("../app"));
});
afterEach(cleanup);
beforeEach(() => localStorage.clear());

const row = (id: string, projectId: string, title: string | null, extra: { status?: string; archivedAt?: number | null; updatedAt?: number } = {}) => ({
  id,
  projectId,
  title,
  titleFallback: null,
  status: "idle",
  providerId: "claude-code",
  archivedAt: null,
  updatedAt: Date.now(),
  ...extra,
});

function canvasPanel(sdk: Record<string, unknown>) {
  const panel = app.navPanels.find((entry) => entry.id === "canvas")!;
  return renderSlot(panel, { subPath: "" }, { context: { projectId: null, threadId: null }, sdk: sdk as never });
}

describe("the Canvas nav page", () => {
  it("has a nav entry titled Canvas", () => {
    expect(app.navPanels.map((entry) => [entry.id, entry.title])).toContainEqual(["canvas", "Canvas"]);
  });

  it("shows every thread, a plain chat thread included, under Agents → its project", async () => {
    canvasPanel({
      projects: { list: async () => [{ id: "p1", name: "Shop" }] },
      threads: { list: async () => [row("t1", "p1", "Plain chat")] },
    });
    expect(await screen.findByRole("button", { name: /^Agents — / })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Shop — / })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Plain chat — / })).toBeTruthy();
  });

  it("shows an empty state, not an error, when there are no threads", async () => {
    canvasPanel({
      projects: { list: async () => [{ id: "p1", name: "Shop" }] },
      threads: { list: async () => [] },
    });
    expect(await screen.findByText("No threads yet.")).toBeTruthy();
  });

  it("still shows threads when the project list cannot be read", async () => {
    canvasPanel({
      projects: {
        list: async () => {
          throw new Error("offline");
        },
      },
      threads: { list: async () => [row("t1", "p1", "Plain chat")] },
    });
    expect(await screen.findByRole("button", { name: /^Plain chat — / })).toBeTruthy();
  });

  it("names the failure when the thread list cannot be read", async () => {
    canvasPanel({
      projects: { list: async () => [] },
      threads: {
        list: async () => {
          throw new Error("offline");
        },
      },
    });
    expect(await screen.findByText("Canvas not available: offline")).toBeTruthy();
  });
});

// BBP-189 AK 4: every filter narrows, an empty project filter hides nothing.
describe("the Canvas filters", () => {
  const sdk = (threads: unknown[]) => ({
    projects: { list: async () => [{ id: "p1", name: "Shop" }, { id: "p2", name: "Blog" }] },
    threads: { list: async () => threads },
  });
  const card = (name: string) => screen.queryByRole("button", { name: new RegExp(`^${name} — `) });

  it("hides archived threads by default and shows them on request", async () => {
    canvasPanel(sdk([row("t1", "p1", "Live"), row("t2", "p1", "Old", { archivedAt: 1 })]));
    expect(await screen.findByRole("button", { name: /^Live — / })).toBeTruthy();
    expect(card("Old")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide archived" }));
    expect(await screen.findByRole("button", { name: /^Old — / })).toBeTruthy();
  });

  it("an empty project filter shows every project; a pick narrows", async () => {
    canvasPanel(sdk([row("t1", "p1", "In shop"), row("t2", "p2", "In blog")]));
    expect(await screen.findByRole("button", { name: /^In shop — / })).toBeTruthy();
    expect(card("In blog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Projects/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Blog" }));
    expect(card("In shop")).toBeNull();
    expect(card("In blog")).toBeTruthy();
  });

  it("narrows by status", async () => {
    canvasPanel(sdk([row("t1", "p1", "Busy", { status: "active" }), row("t2", "p1", "Broken", { status: "error" })]));
    expect(await screen.findByRole("button", { name: /^Busy — / })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Status/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Failed" }));
    expect(card("Busy")).toBeNull();
    expect(card("Broken")).toBeTruthy();
  });

  it("narrows by time window", async () => {
    const twoDays = Date.now() - 48 * 3_600_000;
    canvasPanel(sdk([row("t1", "p1", "Today"), row("t2", "p1", "Stale", { updatedAt: twoDays })]));
    expect(await screen.findByRole("button", { name: /^Stale — / })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Time window" }), { target: { value: "24h" } });
    expect(card("Stale")).toBeNull();
    expect(card("Today")).toBeTruthy();
  });

  it("caps the number of threads, newest first", async () => {
    canvasPanel(sdk([row("t1", "p1", "Newer"), row("t2", "p1", "Older", { updatedAt: Date.now() - 1000 })]));
    expect(await screen.findByRole("button", { name: /^Older — / })).toBeTruthy();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Thread limit" }), { target: { value: "1" } });
    expect(card("Older")).toBeNull();
    expect(card("Newer")).toBeTruthy();
  });

  it("offers a turns-per-thread limit", async () => {
    canvasPanel(sdk([row("t1", "p1", "Live")]));
    const input = (await screen.findByRole("spinbutton", { name: "Turns per thread" })) as HTMLInputElement;
    expect(input.value).toBe("20");
  });

  it("says so when the filters leave no thread", async () => {
    canvasPanel(sdk([row("t2", "p1", "Old", { archivedAt: 1 })]));
    expect(await screen.findByText("No threads match the filters.")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Hide archived" })).toBeTruthy();
  });

  it("opens the search with /", async () => {
    canvasPanel(sdk([row("t1", "p1", "Live")]));
    await screen.findByRole("button", { name: /^Live — / });
    fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "/" });
    expect(screen.getByRole("textbox", { name: "Search nodes" })).toBe(document.activeElement);
  });
});

// BBP-189 AK 5: the chat beside the graph, and the thread panel's "Canvas".
describe("the Canvas chat tab and thread panel action", () => {
  const sdk = (threads: unknown[]) => ({
    projects: { list: async () => [{ id: "p1", name: "Shop" }] },
    threads: { list: async () => threads },
  });
  const chat = () => screen.queryByTestId("bb-thread-chat");

  it("shows the selected thread's chat in a Chat tab beside the graph", async () => {
    canvasPanel(sdk([row("t1", "p1", "First"), row("t2", "p1", "Second")]));
    fireEvent.click(await screen.findByRole("button", { name: /^Second — / }));
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(chat()?.getAttribute("data-thread-id")).toBe("t2");
    fireEvent.click(screen.getByRole("tab", { name: "Graph" }));
    expect(chat()).toBeNull();
    expect(screen.getByRole("button", { name: /^First — / })).toBeTruthy();
  });

  it("asks for a thread when none is selected", async () => {
    canvasPanel(sdk([row("t1", "p1", "First")]));
    fireEvent.click(await screen.findByRole("tab", { name: "Chat" }));
    expect(chat()).toBeNull();
    expect(screen.getByText("Select a thread to see its chat.")).toBeTruthy();
  });

  it("registers a thread panel action titled Canvas", () => {
    expect(app.threadPanelActions.map((entry) => [entry.id, entry.title])).toContainEqual(["canvas", "Canvas"]);
  });

  const threadPanel = (threadId: string, threads: unknown[]) => {
    const action = app.threadPanelActions.find((entry) => entry.id === "canvas")!;
    return renderSlot(action, { threadId, params: null }, { context: { projectId: "p1", threadId }, sdk: sdk(threads) as never });
  };

  it("opens the canvas focused on its thread, with that thread's chat", async () => {
    threadPanel("t2", [row("t1", "p1", "Other"), row("t2", "p1", "Mine")]);
    expect(await screen.findByRole("button", { name: /^Mine — / })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Other — / })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(chat()?.getAttribute("data-thread-id")).toBe("t2");
  });

  it("keeps the focused thread even when the filters would hide it", async () => {
    threadPanel("t2", [row("t2", "p1", "Archived one", { archivedAt: 1 })]);
    expect(await screen.findByRole("button", { name: /^Archived one — / })).toBeTruthy();
  });

  it("shows FocusUnavailable, not a crash, for an unknown thread; Show all clears the focus", async () => {
    threadPanel("gone", [row("t1", "p1", "Other")]);
    expect(await screen.findByRole("status")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show all/ }));
    expect(await screen.findByRole("button", { name: /^Other — / })).toBeTruthy();
  });

  it("focuses a thread named in the nav page's sub-path", async () => {
    const panel = app.navPanels.find((entry) => entry.id === "canvas")!;
    renderSlot(panel, { subPath: "thread/t2" }, { context: { projectId: null, threadId: null }, sdk: sdk([row("t1", "p1", "Other"), row("t2", "p1", "Mine")]) as never });
    expect(await screen.findByRole("button", { name: /^Mine — / })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Other — / })).toBeNull();
  });
});
