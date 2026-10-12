// Details of the selected node: a header (icon, label, status), one section
// per kind with its curated fields (BBP-185), and a collapsed "Details"
// block for everything else a provider put in `meta`. A chat or replay feed
// for `thread`/`turn` nodes is a later ticket, once there is a timeline to
// lazily load into this same slot.
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { clampWidth, DEFAULT_WIDTH, fitWidth, maxWidthFor, MIN_WIDTH } from "../lib/clampWidth";
import { curateMeta, type CanvasNode, type CanvasStatus } from "../lib/types";
import type { RelationGroup } from "../lib/relations";
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
  waiting: "var(--warning)",
  done: "var(--muted-foreground)",
  failed: "var(--destructive)",
  escalated: "var(--warning)",
};

function StatusPill({ status }: { status: CanvasStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        height: 18,
        padding: "0 7px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.02em",
        color,
        // A tint of the status colour, not a bare outline: it keeps the pill
        // legible on both themes without a hex value per theme.
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 45%, transparent)`,
      }}
    >
      {status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}

/** Inline because bb-canvas cannot import BB's Button: the same tokens, the
 *  same 28 px height, and a focus ring from `:focus-visible` in SIDEBAR_CSS. */
const ACTION_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  height: 28,
  padding: "0 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "var(--foreground)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
} as const;

const SIDEBAR_STYLE_ID = "bb-canvas-sidebar-styles";

/** Hover and focus states need real selectors; injected once, like the
 *  pulse in NodeCard. */
const SIDEBAR_CSS = `
  .bb-canvas-action:hover { background: var(--muted); }
  .bb-canvas-action:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
  .bb-canvas-resize::after {
    content: ""; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px;
    background: transparent; transition: background 120ms ease-out;
  }
  .bb-canvas-resize:hover::after { background: var(--border); width: 2px; left: 2px; }
  .bb-canvas-resize:focus-visible { outline: none; }
  .bb-canvas-resize:focus-visible::after, .bb-canvas-resize:active::after {
    background: var(--primary); width: 2px; left: 2px;
  }
`;

function ensureSidebarStyles(): void {
  if (typeof document === "undefined" || document.getElementById(SIDEBAR_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SIDEBAR_STYLE_ID;
  style.textContent = SIDEBAR_CSS;
  document.head.appendChild(style);
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h3
      style={{
        margin: 0,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--muted-foreground)",
      }}
    >
      {children}
    </h3>
  );
}

function FieldList({ fields }: { fields: { label: string; value: string }[] }) {
  return (
    <dl style={{ margin: 0, fontSize: 12, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", lineHeight: 1.4 }}>
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
  /** The node's own relations by kind (BBP-203); a target's name selects it
   *  through `onSelect`. Empty or absent: no section. */
  relations?: readonly RelationGroup[];
  onSelect?: (nodeId: string) => void;
};

function stringMeta(node: CanvasNode, key: string): string | undefined {
  const value = node.meta?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function Sidebar({ node, onClose, onOpenThread, onOpenRun, onOpenCrew, relations = [], onSelect }: SidebarProps) {
  const { curated, details } = curateMeta(node.kind, node.meta);
  const threadId = onOpenThread ? stringMeta(node, "threadId") : undefined;
  const runId = onOpenRun ? stringMeta(node, "runId") : undefined;
  const crew = onOpenCrew ? stringMeta(node, "crew") : undefined;
  const hasActions = threadId !== undefined || runId !== undefined || crew !== undefined;
  const [width, setWidth] = useState(loadWidth);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  // The row the sidebar shares with the canvas; 0 until measured.
  const [containerWidth, setContainerWidth] = useState(0);
  // `width` stays the user's choice (and what is stored); `shown` is that
  // choice capped for a narrow panel, so widening the panel brings it back.
  const shown = fitWidth(width, containerWidth);
  const shownMax = maxWidthFor(containerWidth);

  useEffect(() => {
    const container = asideRef.current?.parentElement;
    if (!container) return;
    setContainerWidth(container.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setContainerWidth(container.clientWidth));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => saveWidth(width), [width]);
  useEffect(ensureSidebarStyles, []);

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
    drag.current = { startX: event.clientX, startWidth: shown };
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const next: Record<string, number> = {
      // From what is on screen, so a key always moves the visible edge.
      ArrowLeft: shown + KEY_STEP,
      ArrowRight: shown - KEY_STEP,
      Home: MIN_WIDTH,
      End: shownMax,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    setWidth(clampWidth(next[event.key]));
  };

  return (
    <aside
      ref={asideRef}
      aria-label={`Details for ${node.label}`}
      // Scrolling a long details list must not pan the canvas underneath it
      // (BBP-199) — React Flow skips its own wheel handling for this class.
      className="nowheel"
      style={{
        position: "relative",
        // border-box: the clamped value is the width on screen, padding and border included.
        boxSizing: "border-box",
        width: shown,
        flexShrink: 0,
        borderLeft: "1px solid var(--border)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        overflowY: "auto",
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize details"
        aria-valuenow={shown}
        aria-valuemin={Math.min(MIN_WIDTH, shownMax)}
        aria-valuemax={shownMax}
        tabIndex={0}
        onMouseDown={startDrag}
        onKeyDown={onKeyDown}
        className="bb-canvas-resize"
        style={{ position: "absolute", left: -4, top: 0, bottom: 0, width: 8, cursor: "col-resize", zIndex: 1 }}
      />
      <header style={{ display: "flex", alignItems: "start", gap: 10 }}>
        <span
          aria-hidden
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: "1px solid var(--border)",
            color: "var(--muted-foreground)",
          }}
        >
          <KindIcon kind={node.kind} />
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{KIND_LABEL[node.kind]}</span>
            {node.status ? <StatusPill status={node.status} /> : null}
          </div>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.3, overflowWrap: "anywhere" }}>
            {node.label}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close details"
          onClick={onClose}
          className="bb-canvas-action"
          style={{ ...ACTION_STYLE, justifyContent: "center", width: 28, padding: 0, border: "none", background: "transparent", color: "var(--muted-foreground)" }}
        >
          <svg aria-hidden width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>
      {curated.length > 0 ? (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionHeading>{KIND_LABEL[node.kind]}</SectionHeading>
          <FieldList fields={curated} />
        </section>
      ) : null}
      {relations.length > 0 ? (
        <section aria-label="Relations" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {relations.map((group) => (
            <div key={group.kind} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <SectionHeading>{group.kind}</SectionHeading>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {group.targets.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    onClick={() => onSelect?.(target.id)}
                    className="bb-canvas-action"
                    style={ACTION_STYLE}
                  >
                    {target.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}
      {hasActions ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {threadId !== undefined ? (
            <button type="button" onClick={() => onOpenThread?.(threadId)} className="bb-canvas-action" style={ACTION_STYLE}>
              Open thread
            </button>
          ) : null}
          {runId !== undefined ? (
            <button type="button" onClick={() => onOpenRun?.(runId)} className="bb-canvas-action" style={ACTION_STYLE}>
              Open run
            </button>
          ) : null}
          {crew !== undefined ? (
            <button type="button" onClick={() => onOpenCrew?.(crew)} className="bb-canvas-action" style={ACTION_STYLE}>
              Open crew
            </button>
          ) : null}
        </div>
      ) : null}
      {details.length > 0 ? (
        <details>
          <summary
            style={{
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--muted-foreground)",
            }}
          >
            Details
          </summary>
          <div style={{ marginTop: 8 }}>
            <FieldList fields={details} />
          </div>
        </details>
      ) : null}
    </aside>
  );
}
