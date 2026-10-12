import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  enrichThreadNodes,
  enrichTurnNodes,
  threadNodeFor,
  threadNodeId,
  timelineToCanvas,
  turnDetailsToCanvas,
  type TimelineRowLike,
} from "../lib/canvas-threads";
import type { CanvasNode } from "../vendor/bb-canvas/lib/types";
import type { ThreadLike } from "../lib/canvas-details";

// Real sdk.threads.timeline() rows (BBP-206 R2a/R2b) — see
// bb-canvas/fixtures/README.md for sources and what is and isn't
// independently verified.
const fixtures = JSON.parse(readFileSync("../bb-canvas/fixtures/real-timeline-rows.json", "utf8")) as Record<string, unknown>;

describe("threadNodeFor", () => {
  it("builds a collapsed thread node under a member with a bound thread", () => {
    const member: CanvasNode = {
      id: "member:a@crew",
      kind: "member",
      label: "a",
      parentId: "crew:crew",
      meta: { threadId: "t1" },
    };
    const thread = threadNodeFor(member);
    expect(thread).toEqual({
      id: "thread:t1",
      kind: "thread",
      label: "Thread",
      parentId: "member:a@crew",
      meta: { threadId: "t1" },
    });
  });

  it("returns null for a node without a bound thread", () => {
    const member: CanvasNode = { id: "member:a@crew", kind: "member", label: "a", parentId: "crew:crew" };
    expect(threadNodeFor(member)).toBeNull();
  });
});

describe("timelineToCanvas", () => {
  it("turns a conversation row into a turn node", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "r1", kind: "conversation", text: "Please fix the bug" }],
    });
    expect(nodes).toEqual([
      {
        id: "row:r1",
        kind: "turn",
        label: "Please fix the bug",
        parentId: threadNodeId("t1"),
        meta: { rowId: "r1", kind: "conversation", text: "Please fix the bug" },
      },
    ]);
  });

  it("keeps a message row's sender and text, so its sidebar has content", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "r1", kind: "conversation", role: "user", text: "Please fix the bug" }],
    });
    expect(nodes[0]!.meta).toMatchObject({ from: "User", text: "Please fix the bug" });
  });

  it("turns a work row into a tool-call node, labelled by its kind", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "r2", kind: "tool" }] });
    expect(nodes[0]).toMatchObject({ id: "row:r2", kind: "tool-call", label: "tool" });
  });

  it("labels a tool-call row by its tool name, not its raw kind", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "r3", kind: "work", workKind: "tool", toolName: "Bash", status: "completed" }],
    });
    expect(nodes[0]).toMatchObject({ id: "row:r3", kind: "tool-call", label: "Bash" });
  });

  it("falls back to the raw kind when a work row has no tool name", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "r4", kind: "mystery-row" }] });
    expect(nodes[0]).toMatchObject({ id: "row:r4", kind: "tool-call", label: "mystery-row" });
  });

  it("maps a delegation row to the subagent kind, labelled by its description", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "r5",
          kind: "work",
          workKind: "delegation",
          toolName: "Task",
          status: "pending",
          description: "fix the flaky test",
        },
      ],
    });
    expect(nodes[0]).toMatchObject({ id: "row:r5", kind: "subagent", label: "Agent: fix the flaky test" });
  });

  it("nests a delegation row's own childRows underneath its canvas node", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "r6",
          kind: "work",
          workKind: "delegation",
          toolName: "Task",
          status: "completed",
          description: "research the bug",
          childRows: [{ id: "r7", kind: "work", workKind: "tool", toolName: "Read", status: "completed" }],
        },
      ],
    });
    const subagent = nodes.find((node) => node.id === "row:r6")!;
    expect(subagent.kind).toBe("subagent");
    expect(nodes.filter((node) => node.parentId === subagent.id).map((node) => node.id)).toEqual(["row:r7"]);
  });

  it("puts status and a short output summary into a delegation's meta", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        { id: "r8", kind: "work", workKind: "delegation", toolName: "Task", status: "completed", description: "list files", output: "ls -la → 3 files" },
      ],
    });
    expect(nodes[0].meta).toMatchObject({ status: "completed", summary: "ls -la → 3 files" });
  });

  it("falls back to a generic tool-call for a delegation row with no description", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "r9", kind: "work", workKind: "delegation", toolName: "Task", status: "pending", description: null }],
    });
    expect(nodes[0]).toMatchObject({ kind: "subagent", label: "Agent: (no description)" });
  });

  it("builds an expandable turn node from the real timeline shape (children: null)", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "turn-1",
          kind: "turn",
          turnId: "turn-1",
          status: "completed",
          summaryCount: 2,
          sourceSeqStart: 10,
          sourceSeqEnd: 20,
          children: null,
        },
      ],
    });
    const turn = nodes.find((node) => node.id === "row:turn-1")!;
    expect(turn.status).toBe("done");
    expect(turn.label).toBe("Turn · 2 steps");
    expect(turn.meta).toMatchObject({
      threadId: "t1",
      turnId: "turn-1",
      sourceSeqStart: 10,
      sourceSeqEnd: 20,
      summaryCount: 2,
    });
  });

  it("carries summaryCount: 0 in meta for a turn with no steps, so it gets no chevron", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "turn-2", kind: "turn", turnId: "turn-2", status: "completed", summaryCount: 0, children: null }],
    });
    expect(nodes[0]!.meta).toMatchObject({ summaryCount: 0 });
  });

  it("nests a turn row's eagerly-provided children under its own canvas node (defensive, not the real SDK shape)", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "turn-3",
          kind: "turn",
          turnId: "turn-3",
          status: "completed",
          summaryCount: 2,
          children: [
            { id: "r1", kind: "conversation", text: "Go" },
            { id: "r2", kind: "tool" },
          ],
        },
      ],
    });
    const turn = nodes.find((node) => node.id === "row:turn-3")!;
    const children = nodes.filter((node) => node.parentId === turn.id);
    expect(children.map((node) => node.id)).toEqual(["row:r1", "row:r2"]);
  });

  it("truncates a long conversation text", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "r1", kind: "conversation", text: "x".repeat(100) }],
    });
    expect(nodes[0]!.label.length).toBeLessThanOrEqual(48);
    expect(nodes[0]!.label.endsWith("…")).toBe(true);
  });

  it("falls back to '(empty)' for a conversation row with no text", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "r1", kind: "conversation", text: "" }] });
    expect(nodes[0]!.label).toBe("(empty)");
  });
});

describe("turnDetailsToCanvas", () => {
  it("maps a turn's lazily-fetched steps under the turn node, same mapping as thread-level rows", () => {
    const { nodes } = turnDetailsToCanvas("row:turn-1", {
      rows: [
        { id: "r1", kind: "work", workKind: "tool", toolName: "Bash", status: "completed" },
        {
          id: "r2",
          kind: "work",
          workKind: "delegation",
          toolName: "Task",
          status: "completed",
          description: "research the bug",
          childRows: [{ id: "r3", kind: "work", workKind: "tool", toolName: "Read", status: "completed" }],
        },
      ],
    });
    expect(nodes.map((node) => node.id)).toEqual(["row:r1", "row:r2", "row:r3"]);
    expect(nodes.filter((node) => node.parentId === "row:turn-1").map((node) => node.id)).toEqual(["row:r1", "row:r2"]);
    expect(nodes.find((node) => node.id === "row:r3")!.parentId).toBe("row:r2");
  });
});

describe("threadNodeFor labels (BBP-209)", () => {
  const member: CanvasNode = { id: "m", kind: "member", label: "a", parentId: null, meta: { threadId: "t1" } };

  it("labels the thread by its title and carries state and provider", () => {
    const thread = threadNodeFor(member, { title: "Fix login bug", state: "idle", provider: "claude-code" })!;
    expect(thread.label).toBe("Fix login bug");
    expect(thread.meta).toEqual({ threadId: "t1", title: "Fix login bug", state: "idle", provider: "claude-code" });
  });

  it("falls back to the truncated first user message", () => {
    const thread = threadNodeFor(member, { firstUserMessage: "y".repeat(100) })!;
    expect(thread.label.length).toBeLessThanOrEqual(48);
    expect(thread.label.endsWith("…")).toBe(true);
  });

  it("falls back to 'Thread' without title or message, never empty", () => {
    expect(threadNodeFor(member, { title: "", firstUserMessage: "  " })!.label).toBe("Thread");
  });
});

// BBP-206 R2b: `work` rows are a 16-way discriminated union on `workKind`
// with disjoint fields, not the one flat shape BBP-207/208/209 assumed —
// see the "Timeline shape" comment on BBP-206. These four (`command`,
// `tool`, `file-change`, `delegation`) are what this round covers.
describe("work row mapping: workKind command (BBP-206 R2b)", () => {
  it("curates command, output, exit code, duration and formatted times for a shell command", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "w1",
          kind: "work",
          workKind: "command",
          command: "bb tasks show BBP-112",
          cwd: "/repo",
          status: "completed",
          output: "Task BBP-112 …",
          exitCode: 0,
          startedAt: 1000,
          completedAt: 1400,
          sourceSeqStart: 9,
        },
      ],
    });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "bb tasks show BBP-112" });
    expect(nodes[0]!.status).not.toBe("failed");
    expect(nodes[0]!.meta).toMatchObject({
      command: "bb tasks show BBP-112",
      cwd: "/repo",
      outputPreview: "Task BBP-112 …",
      exitCode: 0,
      duration: "400ms",
      threadId: "t1",
      sourceSeq: 9,
    });
    expect(nodes[0]!.meta!.startedAt).toMatch(/UTC$/);
    expect(nodes[0]!.meta).not.toHaveProperty("toolName");
    expect(nodes[0]!.meta).not.toHaveProperty("toolArgs");
  });

  it("marks a non-zero exit code as failed, even though exitCode: 0 with error-looking output is not a bug (the tool itself exited 0)", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w2", kind: "work", workKind: "command", command: "grep -rl x", exitCode: 1, output: "" }],
    });
    expect(nodes[0]!.status).toBe("failed");
    expect(nodes[0]!.meta).toMatchObject({ exitCode: 1 });

    const ok = timelineToCanvas("t1", {
      rows: [{ id: "w3", kind: "work", workKind: "command", command: "tsc", exitCode: 0, output: "error TS2322: …" }],
    });
    expect(ok.nodes[0]!.status).not.toBe("failed");
  });

  it("truncates a long command for the card label but keeps the full command in meta", () => {
    const long = "echo " + "x".repeat(100);
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "w4", kind: "work", workKind: "command", command: long }] });
    expect(nodes[0]!.label.length).toBeLessThanOrEqual(48);
    expect(nodes[0]!.meta!.command).toBe(long);
  });

  it("writes no empty fields and no duration/sourceSeq when the data isn't there", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w5", kind: "work", workKind: "command", command: "ls" }],
    });
    const meta = nodes[0]!.meta!;
    for (const value of Object.values(meta)) expect(value === "" || value === undefined || value === null).toBe(false);
    for (const key of ["cwd", "outputPreview", "exitCode", "duration", "startedAt", "completedAt", "sourceSeq", "toolName", "toolArgs"]) {
      expect(meta).not.toHaveProperty(key);
    }
  });
});

describe("work row mapping: workKind tool (BBP-206 R2b)", () => {
  it("curates tool name, formatted args, output and duration — never an exit code (the schema has none)", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "w1",
          kind: "work",
          workKind: "tool",
          toolName: "crew_inbox",
          toolArgs: { limit: 5 },
          output: "2026-10-06T16:25Z msg_… human → concierge-lead@concierge",
          startedAt: 1000,
          completedAt: 1200,
          sourceSeqStart: 8,
        },
      ],
    });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "crew_inbox" });
    expect(nodes[0]!.meta).toMatchObject({
      toolName: "crew_inbox",
      toolArgs: JSON.stringify({ limit: 5 }, null, 2),
      outputPreview: "2026-10-06T16:25Z msg_… human → concierge-lead@concierge",
      duration: "200ms",
      threadId: "t1",
      sourceSeq: 8,
    });
    expect(nodes[0]!.meta).not.toHaveProperty("exitCode");
    expect(nodes[0]!.meta).not.toHaveProperty("command");
    expect(nodes[0]!.status).not.toBe("failed");
  });

  it("curates the command string when toolArgs itself names one", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w2", kind: "work", workKind: "tool", toolName: "Bash", toolArgs: { command: "npm test" } }],
    });
    expect(nodes[0]!.meta).toMatchObject({ command: "npm test" });
    expect(nodes[0]!.meta).not.toHaveProperty("toolArgs");
  });

  it("writes no empty fields for a bare tool row", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w3", kind: "work", workKind: "tool", toolName: "Read", toolArgs: "", output: "" }],
    });
    const meta = nodes[0]!.meta!;
    for (const value of Object.values(meta)) expect(value === "" || value === undefined || value === null).toBe(false);
    for (const key of ["command", "toolArgs", "outputPreview", "duration", "startedAt", "sourceSeq", "exitCode"]) {
      expect(meta).not.toHaveProperty(key);
    }
  });
});

describe("work row mapping: workKind file-change (BBP-206 R2b)", () => {
  it("labels the card by the file name and curates path, change kind and diff stats — no output, no exit code", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "w1",
          kind: "work",
          workKind: "file-change",
          change: { path: "/repo/lib/search.ts", kind: "update", diffStats: { added: 14, removed: 0 } },
          stdout: null,
          stderr: null,
          startedAt: 1000,
          completedAt: 1300,
        },
      ],
    });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "search.ts" });
    expect(nodes[0]!.meta).toMatchObject({
      path: "/repo/lib/search.ts",
      changeKind: "update",
      diffStats: "+14 -0",
      duration: "300ms",
    });
    expect(nodes[0]!.meta).not.toHaveProperty("output");
    expect(nodes[0]!.meta).not.toHaveProperty("outputPreview");
    expect(nodes[0]!.meta).not.toHaveProperty("exitCode");
    expect(nodes[0]!.meta).not.toHaveProperty("toolName");
  });

  it("falls back to the raw kind when change.path is missing", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "w2", kind: "work", workKind: "file-change" }] });
    expect(nodes[0]!.label).toBe("work");
  });

  it("curates stdout/stderr only when present", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w3", kind: "work", workKind: "file-change", change: { path: "a.ts" }, stdout: "note", stderr: null }],
    });
    expect(nodes[0]!.meta).toMatchObject({ stdout: "note" });
    expect(nodes[0]!.meta).not.toHaveProperty("stderr");
  });
});

describe("work row mapping: the other 12 workKinds (BBP-206 R2)", () => {
  it("search: labels by the query, curates query/mode/path", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w1", kind: "work", workKind: "search", query: "tagFilter", mode: "content", path: "components" }],
    });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "tagFilter", meta: { query: "tagFilter", mode: "content", path: "components" } });
  });

  it("web-search: labels by the first query, curates all of them", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w1", kind: "work", workKind: "web-search", queries: ["bb canvas timeline", "sdk timeline row"] }],
    });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "bb canvas timeline" });
    expect(nodes[0]!.meta).toMatchObject({ queries: "bb canvas timeline, sdk timeline row" });
  });

  it("web-fetch: labels by the url, curates url and prompt", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w1", kind: "work", workKind: "web-fetch", url: "https://example.com/docs", prompt: "find the API" }],
    });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "https://example.com/docs", meta: { url: "https://example.com/docs", prompt: "find the API" } });
  });

  it("file-read: labels by the file name, curates the path (the human-reported gap)", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "w1", kind: "work", workKind: "file-read", path: "/repo/AGENTS.md" }] });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "AGENTS.md", meta: { path: "/repo/AGENTS.md" } });
  });

  it("image-view: labels by the file name, curates the path", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "w1", kind: "work", workKind: "image-view", path: "/tmp/screenshot.png" }] });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "screenshot.png", meta: { path: "/tmp/screenshot.png" } });
  });

  it("image-generation: labels by the prompt, curates prompt and error", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w1", kind: "work", workKind: "image-generation", prompt: "a line-art icon of a canvas node", error: null }],
    });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "a line-art icon of a canvas node", meta: { prompt: "a line-art icon of a canvas node" } });
    expect(nodes[0]!.meta).not.toHaveProperty("error");
  });

  it("plan-steps: labels by the explanation, curates the step list", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "w1",
          kind: "work",
          workKind: "plan-steps",
          explanation: "Ship the fix in three steps",
          steps: [{ step: "Reproduce" }, { step: "Fix" }, { step: "Test" }],
        },
      ],
    });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "Ship the fix in three steps" });
    expect(nodes[0]!.meta).toMatchObject({ steps: "Reproduce, Fix, Test" });
  });

  it("extension: labels by its extensionKind", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "w1", kind: "work", workKind: "extension", extensionKind: "ui/confirm" }] });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "ui/confirm", meta: { extensionKind: "ui/confirm" } });
  });

  it("approval: labels a file-edit gate and a permission-grant gate differently", () => {
    const edit = timelineToCanvas("t1", {
      rows: [{ id: "w1", kind: "work", workKind: "approval", approvalKind: "file-edit", lifecycle: "waiting", target: { toolName: "Edit" } }],
    });
    expect(edit.nodes[0]!.label).toBe("Approve: Edit");
    const grant = timelineToCanvas("t1", {
      rows: [{ id: "w2", kind: "work", workKind: "approval", approvalKind: "permission-grant", lifecycle: "pending", target: { toolName: "Bash" } }],
    });
    expect(grant.nodes[0]!.label).toBe("Permission: Bash");
    expect(grant.nodes[0]!.meta).toMatchObject({ lifecycle: "pending", toolName: "Bash" });
  });

  it("form: labels by its title", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w1", kind: "work", workKind: "form", title: "Pick a deploy target", rendererId: "deploy-picker", lifecycle: "pending" }],
    });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "Pick a deploy target", meta: { rendererId: "deploy-picker", lifecycle: "pending" } });
  });

  it("question: labels by the first question's prompt, curates all of them", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w1", kind: "work", workKind: "question", lifecycle: "pending", questions: [{ prompt: "Which library?" }, { prompt: "Why?" }] }],
    });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "Which library?" });
    expect(nodes[0]!.meta).toMatchObject({ questions: "Which library?, Why?" });
  });

  it("workflow: labels by its workflowName, falling back to description", () => {
    const named = timelineToCanvas("t1", { rows: [{ id: "w1", kind: "work", workKind: "workflow", workflowName: "release-review", taskType: "review" }] });
    expect(named.nodes[0]!.label).toBe("release-review");
    const unnamed = timelineToCanvas("t1", { rows: [{ id: "w2", kind: "work", workKind: "workflow", workflowName: null, description: "Review the diff" }] });
    expect(unnamed.nodes[0]!.label).toBe("Review the diff");
  });

  it("falls back to the generic tool-name-or-kind reading for a workKind this mapping has never seen, without crashing or stringifying an object", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "w1", kind: "work", workKind: "future-kind-not-yet-modeled", status: "completed", toolName: "SomeNewTool" }],
    });
    expect(nodes[0]).toMatchObject({ kind: "tool-call", label: "SomeNewTool", meta: { status: "completed" } });
    for (const value of Object.values(nodes[0]!.meta!)) expect(String(value)).not.toContain("[object Object]");
  });
});

describe("system row mapping (BBP-206 R2b)", () => {
  it("gives an error its own failed system-event node", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [{ id: "s1", kind: "system", systemKind: "error", title: "Provider crashed", detail: "stack…" }],
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "system-event", label: "Provider crashed", status: "failed", meta: { detail: "stack…" } });
  });

  it("recognizes the real hyphenated operationKind and shows old/new parent from the nested parentChange object", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "s2",
          kind: "system",
          systemKind: "operation",
          operationKind: "parent-change",
          title: "Thread re-parented",
          detail: null,
          parentChange: {
            action: "transfer",
            previousParentThreadId: "thr_old",
            previousParentThreadTitle: "orch-lead@factory-1",
            nextParentThreadId: "thr_new",
            nextParentThreadTitle: "orch-lead@factory-2",
          },
        },
      ],
    });
    expect(nodes[0]).toMatchObject({
      kind: "system-event",
      label: "Thread re-parented",
      meta: { oldParent: "orch-lead@factory-1", newParent: "orch-lead@factory-2" },
    });
  });

  it("falls back to the bare thread id when a parent-change has no title", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "s3",
          kind: "system",
          systemKind: "operation",
          operationKind: "parent-change",
          title: "Thread re-parented",
          parentChange: { previousParentThreadId: "thr_old", nextParentThreadId: "thr_new" },
        },
      ],
    });
    expect(nodes[0]!.meta).toMatchObject({ oldParent: "thr_old", newParent: "thr_new" });
  });

  it("recognizes context-clear (hyphenated, not context_clear) as its own operation node", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        { id: "s4", kind: "system", systemKind: "operation", operationKind: "context-clear", title: "Context cleared", detail: "Earlier chat is hidden…" },
      ],
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "system-event", label: "Context cleared", meta: { detail: "Earlier chat is hidden…" } });
  });

  it("bundles consecutive debug/reconnect rows into one node", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        { id: "s3", kind: "system", systemKind: "debug", title: "event 1" },
        { id: "s4", kind: "system", systemKind: "reconnect", title: "event 2" },
        { id: "w", kind: "work", workKind: "tool", toolName: "Bash" },
        { id: "s5", kind: "system", systemKind: "debug", title: "event 3" },
      ],
    });
    expect(nodes.map((node) => node.label)).toEqual(["2 system events", "Bash", "1 system event"]);
    expect(nodes[0]).toMatchObject({ kind: "system-event", meta: { titles: ["event 1", "event 2"] } });
  });

  it("bundles a system row without title or detail into a valid node, never a tool-call", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "s6", kind: "system" }] });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "system-event", label: "1 system event" });
    expect(nodes[0]!.meta).not.toHaveProperty("titles");
  });

  it("bundles system rows inside a turn's details too", () => {
    const { nodes } = turnDetailsToCanvas("row:turn", {
      rows: [
        { id: "a", kind: "system", systemKind: "debug", title: "x" },
        { id: "b", kind: "system", systemKind: "debug", title: "y" },
      ],
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "2 system events", parentId: "row:turn" });
  });

  it("bundles a reasoning-heavy turn's operation rows into one node, even though each has its own detail (BBP-206 R2b finding 6)", () => {
    const reasoningRows: TimelineRowLike[] = Array.from({ length: 5 }, (_, i) => ({
      id: `reason-${i}`,
      kind: "system",
      systemKind: "operation",
      operationKind: "reasoning",
      title: `Thought for ${i + 10}s`,
      detail: `Some real reasoning text number ${i}…`,
    }));
    const { nodes } = timelineToCanvas("t1", { rows: reasoningRows });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "system-event", label: "5 system events" });
    expect(nodes[0]!.meta!.titles).toEqual(["Thought for 10s", "Thought for 11s", "Thought for 12s", "Thought for 13s", "Thought for 14s"]);
  });

  it("still stands alone for a non-reasoning operation with detail set, between bundled rows", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        { id: "a", kind: "system", systemKind: "debug", title: "x" },
        { id: "b", kind: "system", systemKind: "operation", operationKind: "warning", title: "Rate limit warning", detail: "90% of quota used" },
        { id: "c", kind: "system", systemKind: "debug", title: "y" },
      ],
    });
    expect(nodes.map((node) => node.label)).toEqual(["1 system event", "Rate limit warning", "1 system event"]);
  });
});

describe("turn firstLine (BBP-206 R2b)", () => {
  it("puts the first line of the user's request into the turn's meta when children are eagerly provided", () => {
    const { nodes } = timelineToCanvas("t1", {
      rows: [
        {
          id: "turn",
          kind: "turn",
          children: [
            { id: "c0", kind: "conversation", role: "assistant", text: "hi" },
            { id: "c1", kind: "conversation", role: "user", text: "Add dark mode\nplease" },
          ],
        },
      ],
    });
    expect(nodes[0]).toMatchObject({ label: "Turn · 2 steps", meta: { firstLine: "Add dark mode" } });
  });

  it("omits firstLine without a user message, and on the real shape where children is always null", () => {
    const { nodes } = timelineToCanvas("t1", { rows: [{ id: "turn", kind: "turn", children: null }] });
    expect(nodes[0]!.meta).not.toHaveProperty("firstLine");
    expect(nodes[0]!.label).toBe("Turn · 0 steps");
  });
});

describe("enrichThreadNodes (BBP-210)", () => {
  const parent: CanvasNode = { id: "member:a@crew", kind: "member", label: "a", parentId: null, meta: { threadId: "t1" } };

  it("replaces the placeholder thread node with its real title, state and provider", async () => {
    const placeholder = threadNodeFor(parent)!;
    const port = {
      get: async () =>
        ({ title: "Fix login bug", status: "idle", displayStatus: "idle", providerId: "claude-code", createdAt: 0, updatedAt: 0 }) as ThreadLike,
      firstUserMessage: async () => undefined,
    };
    const [node] = await enrichThreadNodes([parent], [placeholder], port);
    expect(node).toMatchObject({ label: "Fix login bug", meta: { state: "idle", provider: "claude-code" } });
  });

  it("falls back to the first user message when the thread has no title", async () => {
    const placeholder = threadNodeFor(parent)!;
    const port = {
      get: async () => ({ title: null, status: "idle", providerId: "claude-code", createdAt: 0, updatedAt: 0 }) as ThreadLike,
      firstUserMessage: async () => "Please add dark mode",
    };
    const [node] = await enrichThreadNodes([parent], [placeholder], port);
    expect(node.label).toBe("Please add dark mode");
  });

  it("keeps the placeholder label when the thread cannot be read", async () => {
    const placeholder = threadNodeFor(parent)!;
    const port = {
      get: async (): Promise<ThreadLike> => {
        throw new Error("gone");
      },
      firstUserMessage: async () => undefined,
    };
    const [node] = await enrichThreadNodes([parent], [placeholder], port);
    expect(node).toEqual(placeholder);
  });

  it("leaves every non-thread node untouched, in its original position", async () => {
    const other: CanvasNode = { id: "project:p1", kind: "project", label: "p1", parentId: null };
    const nodes = await enrichThreadNodes([], [other], {
      get: async (): Promise<ThreadLike> => {
        throw new Error("n/a");
      },
      firstUserMessage: async () => undefined,
    });
    expect(nodes).toEqual([other]);
  });
});

describe("enrichTurnNodes (BBP-206 R2b)", () => {
  const turnNode: CanvasNode = {
    id: "row:turn-1",
    kind: "turn",
    label: "Turn · 9 steps",
    parentId: "thread:t1",
    meta: { rowId: "turn-1", threadId: "t1", turnId: "turn-1", sourceSeqStart: 7, sourceSeqEnd: 44, summaryCount: 9 },
  };

  it("replaces the plain label with the first line of the turn's own request, once its steps load", async () => {
    const port = {
      turnDetails: async () => ({
        rows: [{ id: "c1", kind: "conversation", role: "user", text: "Fix the login bug\nmore detail" }] as readonly TimelineRowLike[],
      }),
    };
    const [node] = await enrichTurnNodes([turnNode], port);
    expect(node.label).toBe("Fix the login bug · 9 steps");
    expect(node.meta).toMatchObject({ firstLine: "Fix the login bug" });
  });

  it("leaves the node as-is when no step is a user conversation row", async () => {
    const port = { turnDetails: async () => ({ rows: [{ id: "s1", kind: "system", systemKind: "debug" }] as readonly TimelineRowLike[] }) };
    const [node] = await enrichTurnNodes([turnNode], port);
    expect(node).toEqual(turnNode);
  });

  it("leaves a turn with summaryCount: 0 untouched, without even calling the port", async () => {
    const empty: CanvasNode = { ...turnNode, id: "row:turn-2", meta: { ...turnNode.meta, summaryCount: 0 } };
    const turnDetails = vi.fn(async () => ({ rows: [] }));
    const [node] = await enrichTurnNodes([empty], { turnDetails });
    expect(node).toEqual(empty);
    expect(turnDetails).not.toHaveBeenCalled();
  });

  it("leaves the node as-is when a coordinate is missing", async () => {
    const incomplete: CanvasNode = { ...turnNode, id: "row:turn-3", meta: { rowId: "turn-3", threadId: "t1", summaryCount: 2 } };
    const [node] = await enrichTurnNodes([incomplete], { turnDetails: async () => ({ rows: [] }) });
    expect(node).toEqual(incomplete);
  });

  it("keeps the plain label when the turn's steps fail to load", async () => {
    const [node] = await enrichTurnNodes([turnNode], {
      turnDetails: async () => {
        throw new Error("gone");
      },
    });
    expect(node).toEqual(turnNode);
  });

  it("skips a turn that already has a firstLine (does not refetch)", async () => {
    const already: CanvasNode = { ...turnNode, id: "row:turn-4", meta: { ...turnNode.meta, firstLine: "Already there" } };
    const turnDetails = vi.fn(async () => ({ rows: [] }));
    const [node] = await enrichTurnNodes([already], { turnDetails });
    expect(node).toEqual(already);
    expect(turnDetails).not.toHaveBeenCalled();
  });

  it("leaves every non-turn node untouched", async () => {
    const other: CanvasNode = { id: "project:p1", kind: "project", label: "p1", parentId: null };
    const nodes = await enrichTurnNodes([other], { turnDetails: async () => ({ rows: [] }) });
    expect(nodes).toEqual([other]);
  });
});

describe("BBP-206 R2b acceptance: real timeline fixtures", () => {
  it("workCommandBash: Bash command card, full sidebar, exit code 0 not failed", () => {
    const row = fixtures.workCommandBash as TimelineRowLike;
    const { nodes } = timelineToCanvas(row.id /* unused */, { rows: [row] });
    const node = nodes[0]!;
    expect(node.label).toBe("bb tasks show BBP-112");
    expect(node.status).not.toBe("failed");
    expect(node.meta).toMatchObject({ exitCode: 0, command: (fixtures.workCommandBash as Record<string, string>).command });
    expect(node.meta!.duration).toBe("400ms");
    expect(String(node.meta!.startedAt)).toMatch(/UTC$/);
  });

  it("workCommandFailed: non-zero exit code fails the node", () => {
    const row = fixtures.workCommandFailed as TimelineRowLike;
    const { nodes } = timelineToCanvas("t1", { rows: [row] });
    expect(nodes[0]!.status).toBe("failed");
    expect(nodes[0]!.meta).toMatchObject({ exitCode: 1 });
  });

  it("workToolMcpCall: MCP tool call card and args, no exit code field", () => {
    const row = fixtures.workToolMcpCall as TimelineRowLike;
    const { nodes } = timelineToCanvas("t1", { rows: [row] });
    expect(nodes[0]!.label).toBe("crew_inbox");
    expect(nodes[0]!.meta).not.toHaveProperty("exitCode");
    expect(nodes[0]!.meta!.toolArgs).toBe(JSON.stringify({ limit: 5 }, null, 2));
  });

  it("workFileChangeEdit: file name on the card, path/changeKind/diffStats in meta, no output/exitCode", () => {
    const row = fixtures.workFileChangeEdit as TimelineRowLike;
    const { nodes } = timelineToCanvas("t1", { rows: [row] });
    expect(nodes[0]!.label).toBe("search.ts");
    expect(nodes[0]!.meta).toMatchObject({ changeKind: "update", diffStats: "+14 -0" });
    expect(nodes[0]!.meta).not.toHaveProperty("output");
    expect(nodes[0]!.meta).not.toHaveProperty("exitCode");
  });

  it("workDelegationSubagent: unchanged Agent: <description> label, childRows nested", () => {
    const row = fixtures.workDelegationSubagent as TimelineRowLike;
    const { nodes } = timelineToCanvas("t1", { rows: [row] });
    const subagent = nodes.find((node) => node.id === `row:${row.id}`)!;
    expect(subagent).toMatchObject({ kind: "subagent", label: "Agent: Find where sidenav search filters by tag" });
    expect(nodes.some((node) => node.parentId === subagent.id)).toBe(true);
  });

  it("workFileRead: labels by the file name, curates the path, no toolArgs/command/exitCode field that isn't in the schema", () => {
    const row = fixtures.workFileRead as TimelineRowLike;
    const { nodes } = timelineToCanvas("t1", { rows: [row] });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.label).toBe("AGENTS.md");
    expect(nodes[0]!.meta).toMatchObject({ path: (fixtures.workFileRead as Record<string, string>).path });
    for (const key of ["toolArgs", "command", "exitCode"]) expect(nodes[0]!.meta).not.toHaveProperty(key);
  });

  it("systemOperationContextClear: own node, hyphenated operationKind recognized", () => {
    const row = fixtures.systemOperationContextClear as TimelineRowLike;
    const { nodes } = timelineToCanvas("t1", { rows: [row] });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: "system-event", label: "Context cleared" });
  });

  it("systemOperationParentChange: old/new parent from the nested parentChange's titles", () => {
    const row = fixtures.systemOperationParentChange as TimelineRowLike;
    const { nodes } = timelineToCanvas("t1", { rows: [row] });
    expect(nodes[0]!.meta).toMatchObject({ oldParent: "orch-lead@factory-1", newParent: "orch-lead@factory-2" });
  });

  it("systemBundleCandidate: two debug rows bundle into one node listing both titles", () => {
    const rows = (fixtures.systemBundleCandidate as { rows: TimelineRowLike[] }).rows;
    const { nodes } = timelineToCanvas("t1", { rows });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ label: "2 system events" });
    expect(nodes[0]!.meta!.titles).toEqual(["Preparing Worktree…", "Creating worktree"]);
  });

  it("turnWithManySteps + enrichTurnNodes: card gets the first line of conversationUser's text", async () => {
    const turnRow = fixtures.turnWithManySteps as TimelineRowLike;
    const { nodes } = timelineToCanvas("thr_wyw9bnia2w", { rows: [turnRow] });
    const port = {
      turnDetails: async () => ({ rows: [fixtures.conversationUser as TimelineRowLike, fixtures.conversationAssistant as TimelineRowLike] }),
    };
    const [enriched] = await enrichTurnNodes(nodes, port);
    expect(enriched.label).toMatch(/^\[crew\] Kickoff brief for steps-impl@factory-1 · 9 steps$/);
    expect(enriched.meta!.firstLine).toContain("[crew] Kickoff brief for steps-impl@factory-1");
  });
});
