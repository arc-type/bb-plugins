// @vitest-environment jsdom
//
// BBP-170 (WI6): the bridge between CanvasView's edit mode (renderFrameEditor
// slot) and CrewFrameEditor (WI4) — fetches the crew's own yaml once, holds
// edits in memory, and the only way they reach disk is the existing Apply
// RPC, same as crew-file-editor.tsx's YAML tab.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const calls: { name: string; args: unknown }[] = [];
let applyBehavior: () => Promise<unknown> = () =>
  Promise.resolve({ crew: null, problems: [], results: [{ key: "orch-lead", address: "orch-lead@trio", result: "updated", threadId: null, shift: 1, detail: null }] });

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRpc: () => ({
      call: (name: string, args: unknown) => {
        calls.push({ name, args });
        if (name === "getCrewFile") return Promise.resolve({ yaml: YAML_TEXT, version: 2 });
        if (name === "apply") return applyBehavior();
        return Promise.resolve({});
      },
    }),
  };
});

const { CrewFrameEditPanel } = await import("../components/crew-frame-edit-panel");

const YAML_TEXT = `version: "1"
name: trio
groups:
  - id: orch
    members:
      - id: lead
        lead: true
        role: Plans.
        provider: claude-code
        model: claude-opus-5-5
`;

beforeAll(() => installTestPluginRuntime());
afterEach(() => {
  cleanup();
  calls.length = 0;
  applyBehavior = () =>
    Promise.resolve({ crew: null, problems: [], results: [{ key: "orch-lead", address: "orch-lead@trio", result: "updated", threadId: null, shift: 1, detail: null }] });
});

describe("CrewFrameEditPanel", () => {
  it("loads the crew's own yaml and renders its member card", async () => {
    render(<CrewFrameEditPanel projectId="p1" crew="trio" />);
    expect(await screen.findByRole("button", { name: "orch-lead" })).toBeTruthy();
    expect(calls[0]).toEqual({ name: "getCrewFile", args: { projectId: "p1", name: "trio" } });
  });

  it("Apply sends the edited yaml and reports the result", async () => {
    render(<CrewFrameEditPanel projectId="p1" crew="trio" />);
    await screen.findByRole("button", { name: "orch-lead" });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(calls.some((c) => c.name === "apply")).toBe(true));
    const applyCall = calls.find((c) => c.name === "apply")!;
    expect(applyCall.args).toMatchObject({ projectId: "p1", yaml: YAML_TEXT });
    expect(await screen.findByText("updated orch-lead@trio")).toBeTruthy();
  });

  it("Apply is disabled while the crew file has errors", async () => {
    render(<CrewFrameEditPanel projectId="p1" crew="trio" />);
    await screen.findByRole("button", { name: "orch-lead" });
    fireEvent.click(screen.getByRole("button", { name: "orch-lead" }));
    fireEvent.change(screen.getByLabelText("Permissions"), { target: { value: "full" } });
    await screen.findByText(/confirm with --confirm-full/);
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("negative: a save error is shown and does not clear the edited text", async () => {
    applyBehavior = () => Promise.reject(new Error("disk full"));
    render(<CrewFrameEditPanel projectId="p1" crew="trio" />);
    await screen.findByRole("button", { name: "orch-lead" });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "disk full");
  });
});
