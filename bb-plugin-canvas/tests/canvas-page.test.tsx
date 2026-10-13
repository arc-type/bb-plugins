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

function canvasPanel(sdk: Record<string, unknown>, settings?: Record<string, number>) {
  const panel = app.navPanels.find((entry) => entry.id === "canvas")!;
  // No live events unless a test brings its own `subscribe`.
  const withLive = { subscribe: () => () => {}, ...sdk };
  return renderSlot(panel, { subPath: "" }, { context: { projectId: null, threadId: null }, sdk: withLive as never, ...(settings ? { settings } : {}) });
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
    fireEvent.change(await screen.findByRole("combobox", { name: "Time window" }), { target: { value: "all" } });
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

  it("resets the filters from the empty state", async () => {
    canvasPanel(sdk([row("t1", "p1", "Calm")]));
    expect(await screen.findByRole("button", { name: /^Calm — / })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Status/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Failed" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reset filters" }));
    expect(await screen.findByRole("button", { name: /^Calm — / })).toBeTruthy();
  });

  it("offers a turns-per-thread limit", async () => {
    canvasPanel(sdk([row("t1", "p1", "Live")]));
    const input = (await screen.findByRole("spinbutton", { name: "Turns per thread" })) as HTMLInputElement;
    expect(input.value).toBe("1");
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
    return renderSlot(action, { threadId, params: null }, { context: { projectId: "p1", threadId }, sdk: { subscribe: () => () => {}, ...sdk(threads) } as never });
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

  it("shows FocusUnavailable for an unknown thread when there are no threads at all", async () => {
    threadPanel("gone", []);
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.queryByText("No threads yet.")).toBeNull();
  });

  it("shows FocusUnavailable for an unknown thread when the filters leave nothing", async () => {
    threadPanel("gone", [row("t1", "p1", "Old", { archivedAt: 1 })]);
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.queryByText("No threads match the filters.")).toBeNull();
  });

  it("focuses a thread named in the nav page's sub-path", async () => {
    const panel = app.navPanels.find((entry) => entry.id === "canvas")!;
    renderSlot(panel, { subPath: "thread/t2" }, { context: { projectId: null, threadId: null }, sdk: { subscribe: () => () => {}, ...sdk([row("t1", "p1", "Other"), row("t2", "p1", "Mine")]) } as never });
    expect(await screen.findByRole("button", { name: /^Mine — / })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Other — / })).toBeNull();
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

  it("shows only the newest turns-per-thread turns", async () => {
    const { sdk, timeline } = liveSdk(() => [1, 2, 3].map((n) => ({ ...turnRow(`turn-${n}`), summaryCount: 0 })));
    canvasPanel(sdk);
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Turns per thread" }), { target: { value: "2" } });
    await open(/^Plain chat — /);
    await waitFor(() => expect(timeline).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Turn.* — / })).toHaveLength(2));
  });
});

describe("the Canvas page live", () => {
  it("reloads the turns of an opened thread on thread:changed", async () => {
    let rows = [turnRow("turn-1")];
    const { sdk, timeline, emit } = liveSdk(() => rows);
    canvasPanel(sdk, { overviewTurns: 10 });
    await open(/^Plain chat — /);
    // Once for the canvas, once for the selected thread's Activity list (BBP-291).
    await waitFor(() => expect(timeline).toHaveBeenCalledTimes(2));
    rows = [turnRow("turn-1"), { ...turnRow("turn-2"), summaryCount: 0 }];
    emit({ entity: "thread", id: "t1", changes: ["events-appended"] });
    await waitFor(() => expect(timeline).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Turn.* — / })).toHaveLength(2));
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

// BBP-287 (BBP-225): the overview window — last 12 h, 20 threads, 1 turn,
// live threads always in; the bar names it and offers "Show all".
describe("the Canvas overview window", () => {
  const sdk = (threads: unknown[]) => ({
    projects: { list: async () => [{ id: "p1", name: "Shop" }, { id: "p2", name: "Blog" }] },
    threads: { list: async () => threads },
  });
  const DAY = 24 * 3_600_000;
  const card = (name: string) => screen.queryByRole("button", { name: new RegExp(`^${name} — `) });

  it("shows the last 12 h by default and says so; Show all brings back the rest", async () => {
    canvasPanel(sdk([row("t1", "p1", "Today"), row("t2", "p2", "Stale", { updatedAt: Date.now() - 2 * DAY })]));
    expect(await screen.findByRole("button", { name: /^Today — / })).toBeTruthy();
    expect(card("Stale")).toBeNull();
    // The project with nothing left in view is gone too.
    expect(screen.queryByRole("button", { name: /^Blog — / })).toBeNull();
    expect(screen.getByText("Last 12 h · 1 of 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(await screen.findByRole("button", { name: /^Blog — / })).toBeTruthy();
    expect(screen.getByText("2 of 2")).toBeTruthy();
  });

  it("keeps a running thread three days old in view", async () => {
    canvasPanel(sdk([row("t1", "p1", "Busy", { status: "active", updatedAt: Date.now() - 3 * DAY }), row("t2", "p1", "Done", { updatedAt: Date.now() - 3 * DAY })]));
    expect(await screen.findByRole("button", { name: /^Busy — / })).toBeTruthy();
    expect(card("Done")).toBeNull();
  });

  it("takes window, thread limit and turns from the plugin settings", async () => {
    canvasPanel(sdk([row("t1", "p1", "Yesterday", { updatedAt: Date.now() - 20 * 3_600_000 })]), { windowHours: 24, maxThreads: 5, overviewTurns: 3 });
    expect(await screen.findByRole("button", { name: /^Yesterday — / })).toBeTruthy();
    expect(screen.getByText("Last 24 h · 1 of 1")).toBeTruthy();
    expect((screen.getByRole("spinbutton", { name: "Thread limit" }) as HTMLInputElement).value).toBe("5");
    expect((screen.getByRole("spinbutton", { name: "Turns per thread" }) as HTMLInputElement).value).toBe("3");
  });
});

// S16b (BBP-286): a real turn's steps — command, MCP tool, file read and a
// subagent from `timelineTurnSummaryDetails` — are reachable under the turn.
describe("the Canvas page's tool calls under a turn", () => {
  it("shows a real turn's tool calls and its subagent once the turn is opened", async () => {
    const real = (await import("../../bb-canvas/fixtures/real-timeline-rows.json")).default;
    const steps = [real.workToolMcpCall, real.workCommandBash, real.workFileRead, real.workDelegationSubagent];
    const { sdk } = liveSdk(() => [real.turnWithManySteps]);
    sdk.threads.timelineTurnSummaryDetails.mockImplementation(async () => ({ rows: steps }) as never);
    canvasPanel(sdk);
    await open(/^Plain chat — /);
    await open(/^Turn/);
    expect(await screen.findByRole("button", { name: /^Agent: / })).toBeTruthy();
    for (const label of [String(real.workToolMcpCall.toolName), String(real.workFileRead.path).split("/").pop()!]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `) })).toBeTruthy();
    }
  });
});

describe("the Canvas page's +N earlier steps (BBP-286)", () => {
  const steps = Array.from({ length: 12 }, (_, i) => ({ id: `w${i + 1}`, kind: "work", workKind: "tool", toolName: `tool${i + 1}`, status: "completed" }));

  it("shows the newest ten steps of a turn and the older ones behind +N earlier", async () => {
    const { sdk } = liveSdk(() => [{ ...turnRow("turn-1"), summaryCount: 12 }]);
    sdk.threads.timelineTurnSummaryDetails.mockImplementation(async () => ({ rows: steps }) as never);
    canvasPanel(sdk);
    await open(/^Plain chat — /);
    await open(/^Turn/);
    expect(await screen.findByRole("button", { name: /^tool12 — / })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^tool2 — / })).toBeNull();
    await open(/^\+2 earlier/);
    expect(await screen.findByRole("button", { name: /^tool1 — / })).toBeTruthy();
  });

  it("gives a turn without steps no expander", async () => {
    const { sdk, timelineTurnSummaryDetails } = liveSdk(() => [{ ...turnRow("turn-1"), summaryCount: 0 }]);
    canvasPanel(sdk);
    await open(/^Plain chat — /);
    await screen.findByRole("button", { name: /^Turn/ });
    expect(screen.getByRole("button", { name: /^Collapse Plain chat/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Expand Turn/ })).toBeNull();
    expect(timelineTurnSummaryDetails).not.toHaveBeenCalled();
  });
});

describe("the Canvas Active only toggle (BBP-288)", () => {
  const sdk = (threads: unknown[]) => ({ projects: { list: async () => [{ id: "p1", name: "Shop" }] }, threads: { list: async () => threads } });

  it("is off by default; on, it shows only the running threads", async () => {
    canvasPanel(sdk([row("t1", "p1", "Busy chat", { status: "active" }), row("t2", "p1", "Quiet chat")]));
    const toggle = await screen.findByRole("button", { name: "Active only" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(await screen.findByRole("button", { name: /^Quiet chat — / })).toBeTruthy();
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Quiet chat — / })).toBeNull());
    expect(screen.getByRole("button", { name: /^Busy chat — / })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Active only" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("remembers the toggle across reloads", async () => {
    canvasPanel(sdk([row("t1", "p1", "Busy chat", { status: "active" }), row("t2", "p1", "Quiet chat")]));
    fireEvent.click(await screen.findByRole("button", { name: "Active only" }));
    cleanup();
    canvasPanel(sdk([row("t1", "p1", "Busy chat", { status: "active" }), row("t2", "p1", "Quiet chat")]));
    expect((await screen.findByRole("button", { name: "Active only" })).getAttribute("aria-pressed")).toBe("true");
  });

  it("says nothing is running, and Show everything turns it off", async () => {
    canvasPanel(sdk([row("t2", "p1", "Quiet chat")]));
    fireEvent.click(await screen.findByRole("button", { name: "Active only" }));
    expect(await screen.findByText("Nothing is running right now.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show everything" }));
    expect(await screen.findByRole("button", { name: /^Quiet chat — / })).toBeTruthy();
  });
});

// BBP-290 (BBP-237): J cycles through the running threads and gives the one
// it lands on a halo; shortcuts typed into a field stay in the field.
describe("the Canvas keyboard jump", () => {
  const sdk = (threads: unknown[]) => ({ projects: { list: async () => [{ id: "p1", name: "Shop" }] }, threads: { list: async () => threads } });
  const root = () => document.querySelector("[data-canvas-view]") as HTMLElement;
  const pressed = (name: RegExp) => screen.getByRole("button", { name }).getAttribute("aria-pressed");
  const halo = (name: RegExp) => screen.getByRole("button", { name }).getAttribute("data-halo");

  it("J jumps to a running thread, then the next, and wraps; the target has a halo", async () => {
    canvasPanel(sdk([row("t1", "p1", "Run one", { status: "active" }), row("t2", "p1", "Quiet"), row("t3", "p1", "Run two", { status: "active", updatedAt: Date.now() - 1000 })]));
    await screen.findByRole("button", { name: /^Run one — / });
    fireEvent.keyDown(root(), { key: "j" });
    expect(pressed(/^Run one — /)).toBe("true");
    expect(halo(/^Run one — /)).toBe("true");
    fireEvent.keyDown(root(), { key: "j" });
    expect(pressed(/^Run two — /)).toBe("true");
    expect(halo(/^Run two — /)).toBe("true");
    expect(halo(/^Run one — /)).toBeNull();
    fireEvent.keyDown(root(), { key: "j" });
    expect(pressed(/^Run one — /)).toBe("true");
  });

  it("J does nothing when nothing runs", async () => {
    canvasPanel(sdk([row("t2", "p1", "Quiet")]));
    await screen.findByRole("button", { name: /^Quiet — / });
    fireEvent.keyDown(root(), { key: "j" });
    expect(pressed(/^Quiet — /)).toBe("false");
    expect(document.querySelector("[data-halo]")).toBeNull();
  });

  it("ignores shortcuts typed into a field", async () => {
    canvasPanel(sdk([row("t1", "p1", "Run one", { status: "active" })]));
    await screen.findByRole("button", { name: /^Run one — / });
    const input = screen.getByRole("spinbutton", { name: "Thread limit" });
    const jKey = fireEvent.keyDown(input, { key: "j" });
    expect(pressed(/^Run one — /)).toBe("false");
    // Not swallowed either: "0" must still reach the number field.
    expect(fireEvent.keyDown(input, { key: "0" })).toBe(true);
    expect(jKey).toBe(true);
  });

  it("a click selects without a halo", async () => {
    canvasPanel(sdk([row("t1", "p1", "Run one", { status: "active" })]));
    fireEvent.click(await screen.findByRole("button", { name: /^Run one — / }));
    expect(pressed(/^Run one — /)).toBe("true");
    expect(halo(/^Run one — /)).toBeNull();
  });
});

// BBP-289: from a minimum width, graph and chat side by side; below it the tabs.
describe("the Canvas chat split", () => {
  const sdk = (threads: unknown[]) => ({ projects: { list: async () => [{ id: "p1", name: "Shop" }] }, threads: { list: async () => threads } });
  const chat = () => screen.queryByTestId("bb-thread-chat");
  const original = globalThis.ResizeObserver;
  function withWidth(width: number) {
    globalThis.ResizeObserver = class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  it("shows graph and the selected thread's chat side by side on a wide page, without tabs", async () => {
    withWidth(1200);
    canvasPanel(sdk([row("t1", "p1", "First"), row("t2", "p1", "Second")]));
    fireEvent.click(await screen.findByRole("button", { name: /^Second — / }));
    await waitFor(() => expect(chat()?.getAttribute("data-thread-id")).toBe("t2"));
    expect(screen.getByRole("button", { name: /^First — / })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Chat" })).toBeNull();
  });

  it("shows a hint, not an error, in the split chat without a selection", async () => {
    withWidth(1200);
    canvasPanel(sdk([row("t1", "p1", "First")]));
    expect(await screen.findByText("Select a thread to see its chat.")).toBeTruthy();
    expect(chat()).toBeNull();
  });

  it("keeps the tabs on a narrow page", async () => {
    withWidth(600);
    canvasPanel(sdk([row("t1", "p1", "First")]));
    expect(await screen.findByRole("tab", { name: "Chat" })).toBeTruthy();
    expect(screen.queryByText("Select a thread to see its chat.")).toBeNull();
  });
});

// BBP-291: the selected thread's full Activity list in the canvas sidebar.
describe("the Canvas Activity list", () => {
  const turns = (...ids: string[]) => ids.map((id) => ({ ...turnRow(id), summaryCount: 0 }));
  const activity = () => screen.getByRole("region", { name: "Activity" });

  it("lists every turn of the selected thread and how many the canvas shows", async () => {
    const { sdk } = liveSdk(() => turns("turn-1", "turn-2", "turn-3"));
    canvasPanel(sdk);
    fireEvent.click(await screen.findByRole("button", { name: /^Plain chat — / }));
    expect(await screen.findByText("1 of 3 in canvas")).toBeTruthy();
    expect(activity().querySelectorAll("li")).toHaveLength(3);
  });

  it("brings a turn the canvas hides into view and selects it on a click", async () => {
    const { sdk } = liveSdk(() => turns("turn-1", "turn-2", "turn-3"));
    canvasPanel(sdk);
    fireEvent.click(await screen.findByRole("button", { name: /^Plain chat — / }));
    await screen.findByText("1 of 3 in canvas");
    fireEvent.click(activity().querySelectorAll("li button")[0]!);
    await waitFor(() => expect(document.querySelectorAll('[data-canvas-view] button[aria-pressed="true"]').length).toBe(1));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Turn/ }).length).toBeGreaterThanOrEqual(2));
  });

  it("updates live on thread:changed, and a turn that is gone does not crash", async () => {
    let rows = turns("turn-1", "turn-2");
    const { sdk, emit } = liveSdk(() => rows);
    canvasPanel(sdk);
    fireEvent.click(await screen.findByRole("button", { name: /^Plain chat — / }));
    await screen.findByText("1 of 2 in canvas");
    fireEvent.click(activity().querySelectorAll("li button")[0]!);
    rows = turns("turn-2", "turn-3", "turn-4");
    emit({ entity: "thread", id: "t1", changes: ["events-appended"] });
    expect(await screen.findByText("1 of 3 in canvas")).toBeTruthy();
  });
});

// BBP-283 review fix 4: the Activity list's error path.
describe("the Canvas Activity list when the timeline fails", () => {
  it("leaves the section out, and the canvas keeps working, when the timeline cannot be read", async () => {
    const { sdk } = liveSdk(() => []);
    sdk.threads.timeline.mockImplementation(async () => {
      throw new Error("gone");
    });
    canvasPanel(sdk);
    fireEvent.click(await screen.findByRole("button", { name: /^Plain chat — / }));
    await waitFor(() => expect(sdk.threads.timeline).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Activity" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Other chat — / })).toBeTruthy();
  });

  it("keeps the last list when a live reload fails", async () => {
    const { sdk, emit } = liveSdk(() => [{ ...turnRow("turn-1"), summaryCount: 0 }]);
    canvasPanel(sdk);
    fireEvent.click(await screen.findByRole("button", { name: /^Plain chat — / }));
    await screen.findByText("1 of 1 in canvas");
    sdk.threads.timeline.mockImplementation(async () => {
      throw new Error("offline");
    });
    const calls = sdk.threads.timeline.mock.calls.length;
    emit({ entity: "thread", id: "t1", changes: ["events-appended"] });
    await waitFor(() => expect(sdk.threads.timeline.mock.calls.length).toBeGreaterThan(calls));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText("1 of 1 in canvas")).toBeTruthy();
  });
});
