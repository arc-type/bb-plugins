import { describe, expect, it } from "vitest";
import { curateMeta } from "@/lib/types";

describe("curateMeta", () => {
  it("curates a crew node's fields in a fixed order, by friendly label", () => {
    const { curated } = curateMeta("crew", { crew: "factory-1", status: "running" });
    expect(curated).toEqual([{ label: "Crew", value: "factory-1" }]);
  });

  it("curates a member node's fields", () => {
    const { curated } = curateMeta("member", { address: "a@crew", role: "lead", lead: true, activity: "working" });
    expect(curated).toEqual([
      { label: "Address", value: "a@crew" },
      { label: "Role", value: "lead" },
      { label: "Lead", value: "true" },
      { label: "Activity", value: "working" },
    ]);
  });

  it("curates a tool-call node's tool name and command, not status/summary", () => {
    const { curated } = curateMeta("tool-call", { rowId: "r1", kind: "work", toolName: "Bash", command: "ls" });
    expect(curated).toEqual([
      { label: "Tool", value: "Bash" },
      { label: "Command", value: "ls" },
    ]);
  });

  it("puts every field absent from the kind's curation into details", () => {
    const { curated, details } = curateMeta("crew", { crew: "factory-1", status: "running", mystery: "x" });
    expect(curated).toEqual([{ label: "Crew", value: "factory-1" }]);
    expect(details).toEqual([
      { label: "Status", value: "running" },
      { label: "Mystery", value: "x" },
    ]);
  });

  it("skips a curated field whose value is null, undefined, or missing", () => {
    const { curated } = curateMeta("graph-run", { runId: "r1", graphId: null, threadId: undefined });
    expect(curated).toEqual([{ label: "Run", value: "r1" }]);
  });

  it("returns no curated fields and no details for an empty or absent meta", () => {
    expect(curateMeta("thread", undefined)).toEqual({ curated: [], details: [] });
    expect(curateMeta("thread", {})).toEqual({ curated: [], details: [] });
  });

  it("curates a thread node's SDK details in reading order (BBP-179 acceptance)", () => {
    const { curated, details } = curateMeta("thread", {
      threadId: "thr_1",
      updated: "2026-10-12 09:00 UTC",
      created: "2026-10-12 08:00 UTC",
      turns: 4,
      model: "opus",
      provider: "claude-code",
      state: "idle",
      title: "Fix login",
    });
    expect(curated.map((field) => field.label)).toEqual([
      "Title", "Status", "Provider", "Model", "Turns", "Created", "Updated", "Thread",
    ]);
    expect(details).toEqual([]);
  });

  it("curates a graph run's graph, start time and step progress", () => {
    const { curated } = curateMeta("graph-run", { runId: "r1", graphId: "g1", started: "2026-10-12 08:00 UTC", steps: "2/5", threadId: "t1", status: "running" });
    expect(curated.map((field) => field.label)).toEqual(["Graph", "Run", "Started", "Steps", "Thread"]);
  });

  it("curates a crew's member count and lead", () => {
    const { curated } = curateMeta("crew", { crew: "factory-1", members: 3, lead: "orch-lead", status: "running" });
    expect(curated).toEqual([
      { label: "Crew", value: "factory-1" },
      { label: "Members", value: "3" },
      { label: "Lead", value: "orch-lead" },
    ]);
  });

  it("shows only the thread fields that are present, without empty rows", () => {
    const { curated } = curateMeta("thread", { threadId: "thr_1", model: null });
    expect(curated).toEqual([{ label: "Thread", value: "thr_1" }]);
  });

  it("curates a system-event node's detail", () => {
    const { curated } = curateMeta("system-event", { detail: "Earlier chat is hidden" });
    expect(curated).toEqual([{ label: "Detail", value: "Earlier chat is hidden" }]);
  });

  it("curates a system-event node's old/new parent for a parent-change", () => {
    const { curated } = curateMeta("system-event", { oldParent: "thr_a", newParent: "thr_b" });
    expect(curated).toEqual([
      { label: "Old parent", value: "thr_a" },
      { label: "New parent", value: "thr_b" },
    ]);
  });

  it("curates a bundled system-event node's titles", () => {
    const { curated } = curateMeta("system-event", { titles: "event 1, event 2" });
    expect(curated).toEqual([{ label: "Events", value: "event 1, event 2" }]);
  });

  it("curates a turn node's first line alongside its row id", () => {
    const { curated } = curateMeta("turn", { rowId: "r1", firstLine: "Add dark mode" });
    expect(curated).toEqual([
      { label: "Row", value: "r1" },
      { label: "First line", value: "Add dark mode" },
    ]);
  });

  it("curates a tool-call node's expanded fields", () => {
    const { curated } = curateMeta("tool-call", {
      toolName: "Bash",
      command: "ls -la",
      outputPreview: "3 files",
      exitCode: 0,
      duration: "2.3s",
      startedAt: "2026-10-12 08:00 UTC",
      completedAt: "2026-10-12 08:00:02 UTC",
    });
    expect(curated.map((field) => field.label)).toEqual([
      "Tool", "Command", "Output", "Exit code", "Duration", "Started", "Completed",
    ]);
  });
});
