// @vitest-environment jsdom
//
// BBP-168 (BBP-163 WI4): crew-edit actions for the bb-canvas edit mode — Add
// member/group, link-drag with a kind picker limited to LINK_KINDS, and an
// Inspector composed from inspector.tsx's shared primitives. This component
// does not yet sit inside the live bb-canvas edit mode (WI5/WI6 wire the
// crew-file-editor tabs once the vendor copy is synced in WI8); it owns the
// same YAML-text-in/text-out contract crew-edit-fullscreen.tsx already uses,
// so wiring it in later is a render swap, not a rewrite.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { CrewFrameEditor } from "../components/crew-frame-editor";

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
  - id: dev
    members:
      - id: impl
        role: Implements.
        provider: claude-code
        model: claude-sonnet-5-5
links:
  - from: orch-lead
    to: dev-impl
    kind: assigns_to
`;

const Picker = ({ value, onChange }: { value: { providerId: string; model: string }; onChange: (value: { providerId: string; model: string }) => void }) => (
  <input aria-label="Model stub" value={value.model} onChange={(event) => onChange({ providerId: value.providerId, model: event.target.value })} />
);

function Wrapper({ initialYaml, onChange }: { initialYaml: string; onChange: (yaml: string) => void }) {
  const [yaml, setYaml] = useState(initialYaml);
  return (
    <CrewFrameEditor
      yaml={yaml}
      onChange={(next) => {
        setYaml(next);
        onChange(next);
      }}
      ExecutionPicker={Picker}
    />
  );
}

function setup(yaml = YAML_TEXT) {
  let current = yaml;
  const onChange = vi.fn((next: string) => {
    current = next;
  });
  const view = render(<Wrapper initialYaml={yaml} onChange={onChange} />);
  return { onChange, getCurrent: () => current, ...view };
}

beforeAll(() => installTestPluginRuntime());
afterEach(cleanup);

describe("CrewFrameEditor", () => {
  it("renders one card per member", () => {
    setup();
    expect(screen.getByRole("button", { name: "orch-lead" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "dev-impl" })).toBeTruthy();
  });

  it("adds a member to the selected member's group", () => {
    const { onChange, getCurrent } = setup();
    fireEvent.click(screen.getByRole("button", { name: "dev-impl" }));
    fireEvent.click(screen.getByRole("button", { name: /Add member/ }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(getCurrent()).toContain("id: member");
    expect(screen.getByRole("button", { name: "dev-member" })).toBeTruthy();
  });

  it("adds a group with its own first member", () => {
    const { getCurrent } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Add group/ }));
    expect(getCurrent()).toContain("id: group2");
    expect(screen.getByRole("button", { name: "group2-member" })).toBeTruthy();
  });

  describe("link drag", () => {
    it("dragging from one card to another opens a kind picker limited to LINK_KINDS", () => {
      setup();
      fireEvent.pointerDown(screen.getByRole("button", { name: "dev-impl" }));
      fireEvent.pointerUp(screen.getByRole("button", { name: "orch-lead" }));
      const picker = screen.getByLabelText("Link kind") as HTMLSelectElement;
      const options = Array.from(picker.options).map((option) => option.value);
      expect(options).toEqual(["assigns_to", "works_with", "escalates_to", "can_read"]);
      expect(options).not.toContain("messages");
    });

    it("confirming the picker calls addLinkToFile with the chosen kind", () => {
      const { onChange, getCurrent } = setup();
      fireEvent.pointerDown(screen.getByRole("button", { name: "dev-impl" }));
      fireEvent.pointerUp(screen.getByRole("button", { name: "orch-lead" }));
      fireEvent.change(screen.getByLabelText("Link kind"), { target: { value: "can_read" } });
      fireEvent.click(screen.getByRole("button", { name: "Add link" }));
      expect(onChange).toHaveBeenCalledOnce();
      expect(getCurrent()).toContain("can_read");
    });

    it("releasing outside any card aborts the drag without calling onChange (negative criterion 4)", () => {
      const { container, onChange } = setup();
      fireEvent.pointerDown(screen.getByRole("button", { name: "dev-impl" }));
      fireEvent.pointerUp(container.querySelector("[data-card-area]")!);
      expect(screen.queryByLabelText("Link kind")).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("releasing on the same card the drag started from aborts cleanly", () => {
      setup();
      fireEvent.pointerDown(screen.getByRole("button", { name: "dev-impl" }));
      fireEvent.pointerUp(screen.getByRole("button", { name: "dev-impl" }));
      expect(screen.queryByLabelText("Link kind")).toBeNull();
    });

    it("Cancel closes the picker without calling onChange", () => {
      const { onChange } = setup();
      fireEvent.pointerDown(screen.getByRole("button", { name: "dev-impl" }));
      fireEvent.pointerUp(screen.getByRole("button", { name: "orch-lead" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByLabelText("Link kind")).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("inspector", () => {
    it("selecting a member shows its inspector with model, role and permissions", () => {
      setup();
      fireEvent.click(screen.getByRole("button", { name: "dev-impl" }));
      const inspector = within(screen.getByLabelText("Member inspector"));
      expect(inspector.getByLabelText("Model stub")).toBeTruthy();
      expect(inspector.getByLabelText("Role text")).toBeTruthy();
      expect(inspector.getByLabelText("Permissions")).toBeTruthy();
    });

    it("editing the role updates the YAML via setMemberValue", () => {
      const { getCurrent } = setup();
      fireEvent.click(screen.getByRole("button", { name: "dev-impl" }));
      fireEvent.change(within(screen.getByLabelText("Member inspector")).getByLabelText("Role text"), {
        target: { value: "Builds it." },
      });
      expect(getCurrent()).toContain("Builds it.");
    });

    it("changing the model updates the YAML via setMemberExecution", () => {
      const { getCurrent } = setup();
      fireEvent.click(screen.getByRole("button", { name: "dev-impl" }));
      fireEvent.change(within(screen.getByLabelText("Member inspector")).getByLabelText("Model stub"), {
        target: { value: "claude-haiku-5-5" },
      });
      expect(getCurrent()).toContain("claude-haiku-5-5");
    });

    it("changing permissions updates the YAML via setMemberValue", () => {
      const { getCurrent } = setup();
      fireEvent.click(screen.getByRole("button", { name: "dev-impl" }));
      fireEvent.change(within(screen.getByLabelText("Member inspector")).getByLabelText("Permissions"), {
        target: { value: "full" },
      });
      expect(getCurrent()).toContain("permissions: full");
    });
  });

  describe("validateCrew error state (negative criterion 5)", () => {
    it("shows a validation error without blocking further edits", () => {
      const { getCurrent } = setup(YAML_TEXT.replace("model: claude-sonnet-5-5", ""));
      expect(screen.getByText(/provider and model must both be set/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "dev-impl" }));
      fireEvent.change(within(screen.getByLabelText("Member inspector")).getByLabelText("Role text"), {
        target: { value: "still editable" },
      });
      expect(getCurrent()).toContain("still editable");
    });

    it("shows 'Valid' once every problem is resolved", () => {
      setup();
      expect(screen.getByText("Valid")).toBeTruthy();
    });
  });
});
