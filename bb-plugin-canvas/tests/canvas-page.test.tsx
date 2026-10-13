// @vitest-environment jsdom
//
// The Canvas nav page (BBP-189 AK 1): Agents → projects → every thread BB
// lists, with no crew or Graph Studio RPC anywhere in the way.
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot, type CapturedPluginApp } from "@get-bb/plugin-sdk/testing/app";

let app: CapturedPluginApp;

beforeAll(async () => {
  app = await loadPluginApp(() => import("../app"));
});
beforeEach(() => localStorage.clear());
afterEach(cleanup);

const row = (id: string, projectId: string, title: string | null) => ({
  id,
  projectId,
  title,
  titleFallback: null,
  status: "idle",
  providerId: "claude-code",
  archivedAt: null,
  updatedAt: 0,
});

function canvasPanel(sdk: Record<string, unknown>) {
  const panel = app.navPanels.find((entry) => entry.id === "canvas")!;
  // No live events unless a test brings its own `subscribe`.
  const withLive = { subscribe: () => () => {}, ...sdk };
  return renderSlot(panel, { subPath: "" }, { context: { projectId: null, threadId: null }, sdk: withLive as never });
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

// BBP-189 AK 2 + 3: turns load only when a thread is opened; `thread:changed`
// refreshes a thread's status, and its turns only once they are loaded.
type ThreadChanged = { entity: "thread"; id?: string; changes: string[]; metadata?: Record<string, unknown> };

function liveSdk(timelineRows: () => unknown[]) {
  const listeners: ((event: ThreadChanged) => void)[] = [];
  const timeline = vi.fn(async () => ({ rows: timelineRows() }));
  const timelineTurnSummaryDetails = vi.fn(async () => ({
    rows: [{ id: "w1", kind: "work", workKind: "delegation", toolName: "Task", status: "completed", description: "Review the diff" }],
  }));
  const sdk = {
    projects: { list: async () => [{ id: "p1", name: "Shop" }] },
    threads: { list: async () => [row("t1", "p1", "Plain chat"), row("t2", "p1", "Other chat")], timeline, timelineTurnSummaryDetails },
    subscribe: (args: { event: string; callback: (event: ThreadChanged) => void }) => {
      if (args.event === "thread:changed") listeners.push(args.callback);
      return () => listeners.splice(listeners.indexOf(args.callback), 1);
    },
  };
  const emit = (event: ThreadChanged) => act(() => listeners.forEach((listener) => listener(event)));
  return { sdk, timeline, timelineTurnSummaryDetails, emit };
}

const turnRow = (id: string) => ({ id, kind: "turn", turnId: id, status: "completed", summaryCount: 1, sourceSeqStart: 1, sourceSeqEnd: 2, children: null });

async function open(name: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name }));
  fireEvent.keyDown(document.querySelector("[data-canvas-view]")!, { key: "Enter" });
}

describe("the Canvas page's turns", () => {
  it("loads no timeline for a collapsed thread", async () => {
    const { sdk, timeline } = liveSdk(() => [turnRow("turn-1")]);
    canvasPanel(sdk);
    await screen.findByRole("button", { name: /^Plain chat — / });
    expect(timeline).not.toHaveBeenCalled();
  });

  it("loads a thread's turns on opening it, and a turn's subagent on opening the turn", async () => {
    const { sdk, timeline, timelineTurnSummaryDetails } = liveSdk(() => [turnRow("turn-1")]);
    canvasPanel(sdk);
    await open(/^Plain chat — /);
    await waitFor(() => expect(timeline).toHaveBeenCalledWith({ threadId: "t1" }));
    await open(/^(Turn|Review)/);
    expect(await screen.findByRole("button", { name: /^Agent: Review the diff — / })).toBeTruthy();
    expect(timelineTurnSummaryDetails).toHaveBeenCalled();
  });
});

describe("the Canvas page live", () => {
  it("reloads the turns of an opened thread on thread:changed", async () => {
    let rows = [turnRow("turn-1")];
    const { sdk, timeline, emit } = liveSdk(() => rows);
    canvasPanel(sdk);
    await open(/^Plain chat — /);
    await waitFor(() => expect(timeline).toHaveBeenCalledTimes(1));
    rows = [turnRow("turn-1"), { ...turnRow("turn-2"), summaryCount: 0 }];
    emit({ entity: "thread", id: "t1", changes: ["events-appended"] });
    await waitFor(() => expect(timeline).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Turn/ }).map((b) => b.getAttribute("aria-label"))).toHaveLength(2));
  });

  it("loads nothing for a thread:changed on a thread whose turns are not loaded", async () => {
    const { sdk, timeline, emit } = liveSdk(() => [turnRow("turn-1")]);
    canvasPanel(sdk);
    await screen.findByRole("button", { name: /^Other chat — / });
    emit({ entity: "thread", id: "t2", changes: ["events-appended"] });
    emit({ entity: "thread", id: "unknown", changes: ["events-appended"] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(timeline).not.toHaveBeenCalled();
  });

  it("updates a thread's status from the event", async () => {
    const { sdk, emit } = liveSdk(() => []);
    canvasPanel(sdk);
    await screen.findByRole("button", { name: /^Other chat — / });
    emit({ entity: "thread", id: "t2", changes: ["status-changed"], metadata: { statusChange: { runtime: { displayStatus: "active" } } } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Other chat — / }).querySelector('[data-bb-status-glyph="running"]')).not.toBeNull(),
    );
  });
});
