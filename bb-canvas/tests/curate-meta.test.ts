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

  it("curates a tool-call node's status and summary", () => {
    const { curated } = curateMeta("tool-call", { rowId: "r1", kind: "work", status: "completed", summary: "ls → 3 files" });
    expect(curated).toEqual([
      { label: "Status", value: "completed" },
      { label: "Summary", value: "ls → 3 files" },
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
});
