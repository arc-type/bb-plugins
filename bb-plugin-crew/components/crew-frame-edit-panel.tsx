// Bridges bb-canvas's edit mode (CanvasView's renderFrameEditor slot) to
// CrewFrameEditor (BBP-168 WI4): fetches the crew's own yaml once, holds
// edits in memory, and applies them through the same `apply` RPC
// crew-file-editor.tsx's YAML tab uses — there is still only one way to
// write the crew file to disk.
import { useEffect, useState, type CSSProperties } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { validateCrew } from "../lib/spec";
import { CrewFrameEditor } from "./crew-frame-editor";

export type CrewFrameEditPanelProps = {
  projectId: string;
  crew: string;
};

export function CrewFrameEditPanel({ projectId, crew }: CrewFrameEditPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [yaml, setYaml] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setYaml(null);
    rpc.call("getCrewFile", { projectId, name: crew }).then((result) => {
      if (!cancelled) setYaml(result.yaml ?? "");
    });
    return () => {
      cancelled = true;
    };
    // `rpc` is excluded on purpose: this only has to run once per crew, not
    // on every render — `useRpc()` is not guaranteed to return the same
    // object identity twice, and depending on it here re-fetches the file
    // (and so drops in-memory edits) after every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, crew]);

  if (yaml === null) {
    return (
      <aside style={PANEL_STYLE} aria-label={`Editing ${crew}`}>
        <p className="text-xs text-muted-foreground">Loading…</p>
      </aside>
    );
  }

  const errors = validateCrew(yaml).problems.filter((problem) => problem.level === "error");

  async function apply() {
    setApplying(true);
    setError(null);
    try {
      const result = await rpc.call("apply", { projectId, yaml: yaml!, fresh: [], confirmFull: false });
      setApplied(result.results.map((entry) => `${entry.result} ${entry.address}${entry.detail ? ` (${entry.detail})` : ""}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setApplying(false);
    }
  }

  return (
    <aside style={PANEL_STYLE} aria-label={`Editing ${crew}`}>
      <CrewFrameEditor yaml={yaml} onChange={setYaml} />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <button type="button" disabled={errors.length > 0 || applying} onClick={() => void apply()}>
        Apply
      </button>
      {applied ? (
        <ul aria-label="Apply results" className="text-xs text-muted-foreground">
          {applied.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

const PANEL_STYLE: CSSProperties = {
  width: 380,
  flexShrink: 0,
  borderLeft: "1px solid var(--border)",
  padding: 12,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
