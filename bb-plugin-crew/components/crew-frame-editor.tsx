// Crew-edit actions for the bb-canvas edit mode (BBP-163 WI4): "Add member" /
// "Add group", a drag-to-link gesture between member cards with a kind picker
// limited to `LINK_KINDS` (`messages` is runtime traffic, not a declared
// link — it never appears here), and a per-member Inspector composed from
// inspector.tsx's shared primitives.
//
// Pure text-in/text-out, same contract as crew-edit-fullscreen.tsx: every
// action reads `yaml`, calls one lib/crew-edit.ts function, and hands the
// result to `onChange`. `validateCrew` reruns after every change and its
// problems are shown, but — per spec — never block editing here, only Apply
// (crew-file-editor.tsx, WI5).
//
// This does not yet render inside bb-canvas's own edit mode: the vendor copy
// of bb-canvas in this plugin predates CanvasFrame/edit-mode (BBP-165/166)
// and only gets synced in WI8. Card layout here is a plain button grid, not a
// `CanvasShell` tree — WI6 swaps the rendering once the vendor is current,
// without touching the actions wired up here.
import { type ComponentType, useState } from "react";
import { experimental_ProviderModelPicker } from "@get-bb/plugin-sdk/app";
import { InspectorHeader, InspectorSection } from "./inspector";
import { LINK_KINDS, PERMISSIONS, validateCrew, type LinkKind } from "../lib/spec";
import { addGroupToFile, addLinkToFile, editorModel, nextMemberId, setMemberExecution, setMemberValue, type EditorMember } from "../lib/crew-edit";

type ExecutionValue = { providerId: string; model: string; reasoningLevel?: string; serviceTier?: string };
export type ExecutionPickerProps = { value: ExecutionValue; onChange: (value: ExecutionValue) => void };

const DefaultPicker = experimental_ProviderModelPicker as unknown as ComponentType<ExecutionPickerProps>;

export type CrewFrameEditorProps = {
  yaml: string;
  onChange: (yaml: string) => void;
  ExecutionPicker?: ComponentType<ExecutionPickerProps>;
};

export function CrewFrameEditor({ yaml, onChange, ExecutionPicker = DefaultPicker }: CrewFrameEditorProps) {
  const model = editorModel(yaml);
  if (!model) return <p>The crew file does not parse.</p>;
  return <CrewFrameEditorView yaml={yaml} model={model} onChange={onChange} ExecutionPicker={ExecutionPicker} />;
}

function CrewFrameEditorView({
  yaml,
  model,
  onChange,
  ExecutionPicker,
}: {
  yaml: string;
  model: NonNullable<ReturnType<typeof editorModel>>;
  onChange: (yaml: string) => void;
  ExecutionPicker: ComponentType<ExecutionPickerProps>;
}) {
  const validation = validateCrew(yaml);
  const errors = validation.problems.filter((problem) => problem.level === "error");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<{ from: string; to: string } | null>(null);
  const [linkKind, setLinkKind] = useState<LinkKind>("works_with");

  const member = model?.members.find((entry) => entry.key === selectedKey) ?? null;

  const edit = (run: (current: string) => string) => onChange(run(yaml));

  function addMember() {
    if (!model || !member) return;
    const id = nextMemberId(model, member.group);
    edit((current) => addGroupToFile(current, member.group, id));
  }

  function addGroup() {
    if (!model) return;
    let n = 2;
    while (model.groups.includes(`group${n}`)) n++;
    edit((current) => addGroupToFile(current, `group${n}`, "member"));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (dragFrom === null) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-member-key]");
    const to = target?.dataset.memberKey;
    const from = dragFrom;
    setDragFrom(null);
    // No card under the pointer, or dropped back on the card the drag
    // started from: abort cleanly, no `addLinkToFile` call (negative
    // criterion 4).
    if (!to || to === from) return;
    setPendingLink({ from, to });
  }

  function confirmLink() {
    if (!pendingLink) return;
    edit((current) => addLinkToFile(current, pendingLink.from, pendingLink.to, linkKind));
    setPendingLink(null);
  }

  return (
    <div>
      <div>
        <button type="button" disabled={!model || !member} onClick={addMember}>
          Add member
        </button>
        <button type="button" disabled={!model} onClick={addGroup}>
          Add group
        </button>
      </div>
      <p>{errors.length === 0 ? "Valid" : errors.map((problem) => problem.message).join("; ")}</p>
      <div data-card-area onPointerUp={handlePointerUp}>
        {model?.members.map((entry) => (
          <button
            key={entry.key}
            type="button"
            data-member-key={entry.key}
            aria-pressed={entry.key === selectedKey}
            onPointerDown={() => setDragFrom(entry.key)}
            onClick={() => setSelectedKey(entry.key)}
          >
            {entry.key}
          </button>
        ))}
      </div>
      {pendingLink ? (
        <div role="dialog" aria-label={`Link ${pendingLink.from} to ${pendingLink.to}`}>
          <label>
            Link kind
            <select aria-label="Link kind" value={linkKind} onChange={(event) => setLinkKind(event.target.value as LinkKind)}>
              {LINK_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={confirmLink}>
            Add link
          </button>
          <button type="button" onClick={() => setPendingLink(null)}>
            Cancel
          </button>
        </div>
      ) : null}
      {member ? <MemberInspector member={member} onEdit={edit} ExecutionPicker={ExecutionPicker} /> : null}
    </div>
  );
}

function MemberInspector({
  member,
  onEdit,
  ExecutionPicker,
}: {
  member: EditorMember;
  onEdit: (run: (current: string) => string) => void;
  ExecutionPicker: ComponentType<ExecutionPickerProps>;
}) {
  return (
    <div aria-label="Member inspector">
      <InspectorHeader title={member.key} subtitle={member.group} />
      <InspectorSection title="Model" summary={[member.provider, member.model].filter(Boolean).join(" · ") || "inherited"}>
        <ExecutionPicker
          value={{
            providerId: member.provider,
            model: member.model,
            reasoningLevel: member.reasoningLevel || "medium",
            ...(member.serviceTier ? { serviceTier: member.serviceTier } : {}),
          }}
          onChange={(value) => onEdit((current) => setMemberExecution(current, member.key, value))}
        />
      </InspectorSection>
      <InspectorSection title="Role" summary={member.role || "none"}>
        <textarea
          aria-label="Role text"
          value={member.role}
          onChange={(event) => onEdit((current) => setMemberValue(current, member.key, "role", event.target.value))}
        />
      </InspectorSection>
      <InspectorSection title="Permissions" summary={member.permissions || "inherited"}>
        <select
          aria-label="Permissions"
          value={member.permissions}
          onChange={(event) => onEdit((current) => setMemberValue(current, member.key, "permissions", event.target.value))}
        >
          <option value="">(inherited)</option>
          {PERMISSIONS.map((permission) => (
            <option key={permission} value={permission}>
              {permission}
            </option>
          ))}
        </select>
      </InspectorSection>
    </div>
  );
}
