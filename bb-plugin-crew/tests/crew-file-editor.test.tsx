// @vitest-environment jsdom
//
// BBP-169 (BBP-163 WI5): "Canvas" and "YAML" tabs over the same YAML-text
// state. Tab switches must not lose edits, and a YAML syntax error must show
// as an error state on the Canvas tab, not a crash (negative criterion 6).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const planCalls: unknown[] = [];

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useRpc: () => ({
      call: (name: string, args: unknown) => {
        if (name === "plan") {
          planCalls.push(args);
          return Promise.resolve({ items: [], problems: [] });
        }
        return Promise.resolve({});
      },
    }),
  };
});

const { CrewFileEditor } = await import("../components/crew-file-editor");

const YAML_TEXT = `version: "1"
name: mst-factory
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
afterEach(cleanup);

function setup() {
  return render(<CrewFileEditor projectId="p1" initialYaml={YAML_TEXT} />);
}

describe("CrewFileEditor tabs (BBP-169)", () => {
  it("shows Canvas and YAML tabs", () => {
    setup();
    expect(screen.getByRole("tab", { name: "Canvas" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "YAML" })).toBeTruthy();
  });

  it("defaults to the YAML tab", () => {
    setup();
    expect(screen.getByRole("tab", { name: "YAML" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Crew file YAML")).toBeTruthy();
  });

  it("the Canvas tab renders a member card from the same YAML", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: "Canvas" }));
    expect(screen.getByRole("button", { name: "orch-lead" })).toBeTruthy();
  });

  it("switching from YAML to Canvas and back keeps an edit made in the YAML tab", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Crew file YAML"), { target: { value: YAML_TEXT.replace("Plans.", "Plans everything.") } });
    fireEvent.click(screen.getByRole("tab", { name: "Canvas" }));
    fireEvent.click(screen.getByRole("tab", { name: "YAML" }));
    expect((screen.getByLabelText("Crew file YAML") as HTMLTextAreaElement).value).toContain("Plans everything.");
  });

  it("an edit made on the Canvas tab shows up in the YAML tab", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: "Canvas" }));
    fireEvent.click(screen.getByRole("button", { name: "orch-lead" }));
    fireEvent.change(screen.getByLabelText("Role text"), { target: { value: "Plans differently." } });
    fireEvent.click(screen.getByRole("tab", { name: "YAML" }));
    expect((screen.getByLabelText("Crew file YAML") as HTMLTextAreaElement).value).toContain("Plans differently.");
  });

  it("an edit on the Canvas tab triggers the same debounced plan RPC the YAML tab uses", async () => {
    setup();
    await waitFor(() => expect(planCalls.length).toBeGreaterThan(0));
    planCalls.length = 0;
    fireEvent.click(screen.getByRole("tab", { name: "Canvas" }));
    fireEvent.click(screen.getByRole("button", { name: "orch-lead" }));
    fireEvent.change(screen.getByLabelText("Role text"), { target: { value: "New role." } });
    await waitFor(() => expect(planCalls.length).toBeGreaterThan(0));
    expect((planCalls[0] as { yaml: string }).yaml).toContain("New role.");
  });

  it("a YAML syntax error shows as an error state on the Canvas tab, not a crash (negative criterion 6)", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Crew file YAML"), { target: { value: "groups: [" } });
    expect(() => fireEvent.click(screen.getByRole("tab", { name: "Canvas" }))).not.toThrow();
    expect(screen.getByText(/does not parse/)).toBeTruthy();
  });
});
