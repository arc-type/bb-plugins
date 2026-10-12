// Identical in crew and graph-studio, like the module it tests.
import { describe, expect, it, vi } from "vitest";
import { loadNodeDetails, threadDetails, type ThreadDetailsPort } from "../lib/canvas-details";
import type { CanvasNode } from "../vendor/bb-canvas/lib/types";

const at = (iso: string) => Date.parse(iso);

const thread = {
  title: "Fix login",
  titleFallback: null,
  status: "idle",
  displayStatus: "idle",
  providerId: "claude-code",
  createdAt: at("2026-10-12T08:00:00Z"),
  updatedAt: at("2026-10-12T09:30:00Z"),
};

describe("threadDetails (BBP-179 acceptance)", () => {
  it("maps status, provider, model, times and the turn count", () => {
    const rows = [{ kind: "turn" }, { kind: "conversation" }, { kind: "turn" }, { kind: "work" }];
    expect(threadDetails(thread, "opus-5", rows)).toEqual({
      title: "Fix login",
      state: "idle",
      provider: "claude-code",
      model: "opus-5",
      turns: 2,
      created: "2026-10-12 08:00 UTC",
      updated: "2026-10-12 09:30 UTC",
    });
  });

  it("prefers BB's display status and falls back to the title fallback", () => {
    const details = threadDetails({ ...thread, title: null, titleFallback: "New thread", displayStatus: "provisioning" }, null, null);
    expect(details.title).toBe("New thread");
    expect(details.state).toBe("provisioning");
  });

  it("leaves out what BB did not say, instead of showing null or 0", () => {
    const details = threadDetails({ ...thread, title: null, titleFallback: null }, null, null);
    expect(details).not.toHaveProperty("title");
    expect(details).not.toHaveProperty("model");
    expect(details).not.toHaveProperty("turns");
  });

  it("counts zero turns as 0 when the timeline loaded but is empty", () => {
    expect(threadDetails(thread, null, []).turns).toBe(0);
  });
});

function port(overrides: Partial<ThreadDetailsPort> = {}): ThreadDetailsPort {
  return {
    get: vi.fn(async () => thread),
    model: vi.fn(async () => "opus-5"),
    timelineRows: vi.fn(async () => [{ kind: "turn" }]),
    ...overrides,
  };
}

const threadNode: CanvasNode = { id: "thread:thr_1", kind: "thread", label: "Thread", parentId: "m1", meta: { threadId: "thr_1" } };

describe("loadNodeDetails", () => {
  it("loads a thread node's details from all three SDK calls", async () => {
    const sdk = port();
    const details = await loadNodeDetails(sdk, threadNode);
    expect(sdk.get).toHaveBeenCalledWith("thr_1");
    expect(details).toMatchObject({ provider: "claude-code", model: "opus-5", turns: 1 });
  });

  it("still shows the thread when the model or timeline call fails", async () => {
    const details = await loadNodeDetails(
      port({ model: vi.fn(async () => Promise.reject(new Error("x"))), timelineRows: vi.fn(async () => Promise.reject(new Error("y"))) }),
      threadNode,
    );
    expect(details).toMatchObject({ provider: "claude-code", state: "idle" });
    expect(details).not.toHaveProperty("model");
    expect(details).not.toHaveProperty("turns");
  });

  it("returns null when the thread itself cannot be read", async () => {
    expect(await loadNodeDetails(port({ get: vi.fn(async () => Promise.reject(new Error("404"))) }), threadNode)).toBeNull();
  });

  it("returns null without any SDK call for nodes that are not threads", async () => {
    const sdk = port();
    const member: CanvasNode = { id: "m1", kind: "member", label: "orch-lead", parentId: null, meta: { threadId: "thr_1" } };
    expect(await loadNodeDetails(sdk, member)).toBeNull();
    expect(sdk.get).not.toHaveBeenCalled();
  });
});
