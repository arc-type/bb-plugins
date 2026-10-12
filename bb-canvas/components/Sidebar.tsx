// Details of the selected node: a header (icon, label, status), one section
// per kind with its curated fields (BBP-185), and a collapsed "Details"
// block for everything else a provider put in `meta`. A chat or replay feed
// for `thread`/`turn` nodes is a later ticket, once there is a timeline to
// lazily load into this same slot.
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { clampWidth, DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH } from "../lib/clampWidth";
import { curateMeta, type CanvasNode, type CanvasStatus } from "../lib/types";
import { KindIcon, KIND_LABEL } from "./KindIcon";

const WIDTH_KEY = "bb-canvas:sidebar-width";
const KEY_STEP = 16;

/** Never throws — same reasoning as the colour mode in CanvasView: no or a
 *  broken `localStorage` means the default width, not a crashed canvas. */
function loadWidth(): number {
  try {
    const stored = localStorage.getItem(WIDTH_KEY);
    // `Number(null)` is 0, which would clamp to the minimum instead of the default.
    return stored === null ? DEFAULT_WIDTH : clampWidth(Number(stored));
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(width));
  } catch {
    // Not persisted; the width still holds for this session.
  }
}

/** One fixed pill colour per status — the same precedence NodeCard's border
 *  uses, just as a background instead of an outline. */
const STATUS_COLOR: Record<CanvasStatus, string> = {
  idle: "var(--muted-foreground)",
  running: "var(--primary)",
  waiting: "#d97706",
  done: "var(--muted-foreground)",
  failed: "var(--destructive)",
  escalated: "#d97706",
};

function StatusPill({ status }: { status: CanvasStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignSelf: "start",
        marginTop: 2,
        padding: "1px 6px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
      }}
    >
      {status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}

function FieldList({ fields }: { fields: { label: string; value: string }[] }) {
  return (
    <dl style={{ margin: 0, fontSize: 12, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 8px" }}>
      {fields.map((field) => (
        <div key={field.label} style={{ display: "contents" }}>
          <dt style={{ color: "var(--muted-foreground)" }}>{field.label}</dt>
          <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type SidebarProps = {
  node: CanvasNode;
  onClose: () => void;
  /** Shown as "Open thread" only when `meta.threadId` is a string. */
  onOpenThread?: (threadId: string) => void;
  /** Shown as "Open run" only when `meta.runId` is a string. */
  onOpenRun?: (runId: string) => void;
  /** Shown as "Open crew" only when `meta.crew` is a string. */
  onOpenCrew?: (crew: string) => void;
};

function stringMeta(node: CanvasNode, key: string): string | undefined {
  const value = node.meta?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function Sidebar({ node, onClose, onOpenThread, onOpenRun, onOpenCrew }: SidebarProps) {
  const { curated, details } = curateMeta(node.kind, node.meta);
  const threadId = onOpenThread ? stringMeta(node, "threadId") : undefined;
  const runId = onOpenRun ? stringMeta(node, "runId") : undefined;
  const crew = onOpenCrew ? stringMeta(node, "crew") : undefined;
  const hasActions = threadId !== undefined || runId !== undefined || crew !== undefined;
  const [width, setWidth] = useState(loadWidth);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => saveWidth(width), [width]);

  useEffect(() => {
    // The handle sits on the left edge, so moving the pointer left widens.
    const onMove = (event: globalThis.MouseEvent) => {
      if (!drag.current) return;
      setWidth(clampWidth(drag.current.startWidth + drag.current.startX - event.clientX));
    };
    const onUp = () => {
      drag.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = (event: MouseEvent) => {
    event.preventDefault();
    drag.current = { startX: event.clientX, startWidth: width };
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const next: Record<string, number> = {
      ArrowLeft: width + KEY_STEP,
      ArrowRight: width - KEY_STEP,
      Home: MIN_WIDTH,
      End: MAX_WIDTH,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    setWidth(clampWidth(next[event.key]));
  };

  return (
    <aside
      aria-label={`Details for ${node.label}`}
      style={{
        position: "relative",
        // border-box: the clamped value is the width on screen, padding and border included.
        boxSizing: "border-box",
        width,
        flexShrink: 0,
        borderLeft: "1px solid var(--border)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize details"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        onMouseDown={startDrag}
        onKeyDown={onKeyDown}
        style={{ position: "absolute", left: -3, top: 0, bottom: 0, width: 6, cursor: "col-resize" }}
      />
      <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "start", gap: 8, minWidth: 0 }}>
          <span aria-hidden style={{ display: "flex", flexShrink: 0, marginTop: 2, color: "var(--muted-foreground)" }}>
            <KindIcon kind={node.kind} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{node.label}</div>
            <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{KIND_LABEL[node.kind]}</div>
          </div>
        </div>
        <button type="button" aria-label="Close details" onClick={onClose} style={{ cursor: "pointer", flexShrink: 0 }}>
          ×
        </button>
      </div>
      {node.status ? <StatusPill status={node.status} /> : null}
      {curated.length > 0 ? <FieldList fields={curated} /> : null}
      {hasActions ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {threadId !== undefined ? (
            <button type="button" onClick={() => onOpenThread?.(threadId)} style={{ cursor: "pointer", fontSize: 12 }}>
              Open thread
            </button>
          ) : null}
          {runId !== undefined ? (
            <button type="button" onClick={() => onOpenRun?.(runId)} style={{ cursor: "pointer", fontSize: 12 }}>
              Open run
            </button>
          ) : null}
          {crew !== undefined ? (
            <button type="button" onClick={() => onOpenCrew?.(crew)} style={{ cursor: "pointer", fontSize: 12 }}>
              Open crew
            </button>
          ) : null}
        </div>
      ) : null}
      {details.length > 0 ? (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--muted-foreground)" }}>Details</summary>
          <div style={{ marginTop: 6 }}>
            <FieldList fields={details} />
          </div>
        </details>
      ) : null}
    </aside>
  );
}
