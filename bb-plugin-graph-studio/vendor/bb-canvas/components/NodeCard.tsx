// The one card shape every `CanvasNode` kind renders as. A navigation tree
// with a different card per kind drifts the moment one of them gets a new
// field and the others do not — one shape, and the kind says itself through
// the label and the icon slot the caller fills in.
//
// Status always wins the border: a failed or needs-input card must never
// blend into the background, in either colour mode (BBP-146). Type colour is
// the quieter signal underneath it, for a reader who wants to scan "what
// kind of thing is this" before "is it in trouble".
import type { ReactNode } from "react";
import type { CanvasNodeKind, CanvasStatus } from "../lib/types";

export type NodeCardColorMode = "status" | "type";

export type NodeCardProps = {
  label: string;
  subtitle?: string;
  status?: CanvasStatus;
  kind?: CanvasNodeKind;
  /** "status" (default) leaves a neutral card outside an error/running
   *  state; "type" tints that same neutral card by `kind` instead. */
  colorMode?: NodeCardColorMode;
  /** A single-colour line icon, left of the label. */
  icon?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  /** Outside the frame currently being edited (BBP-166): faded and locked,
   *  not merely unclickable — a reader must see at a glance which layer is
   *  live right now. */
  dimmed?: boolean;
};

/** One fixed accent per kind — not derived from the id, unlike aside's
 *  per-project badge colours: every card of one kind should read the same
 *  everywhere, not get its own hash. */
const KIND_COLOR: Record<CanvasNodeKind, string> = {
  agents: "#64748b",
  project: "#2563eb",
  crew: "#7c3aed",
  member: "#0d9488",
  "graph-run": "#ea580c",
  step: "#0891b2",
  thread: "#db2777",
  turn: "#65a30d",
  "tool-call": "#d97706",
  subagent: "#4f46e5",
};

const AMBER = "#d97706";

const PULSE_CLASS = "bb-canvas-pulse";
const STYLE_ID = "bb-canvas-node-card-styles";

/** Injected once, module-wide: React has no `@keyframes`, and a reader who
 *  asked their OS for less motion must get a still (but still legible)
 *  "running" card, not a silent downgrade to "idle". */
function ensurePulseStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes ${PULSE_CLASS} {
      0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--primary) 55%, transparent); }
      50% { box-shadow: 0 0 0 4px transparent; }
    }
    .${PULSE_CLASS} { animation: ${PULSE_CLASS} 1.6s ease-in-out infinite; }
    @media (prefers-reduced-motion: reduce) {
      .${PULSE_CLASS} { animation: none; box-shadow: 0 0 0 2px var(--primary); }
    }
  `;
  document.head.appendChild(style);
}

type Border = { border: string; pulse: boolean };

/** Status beats type beats neutral — an error or a running card must read
 *  the same regardless of which colour mode the toolbar is set to. */
function borderFor(status: CanvasStatus | undefined, kind: CanvasNodeKind | undefined, colorMode: NodeCardColorMode): Border {
  if (status === "failed") return { border: `1.5px solid var(--destructive)`, pulse: false };
  // 2px, not 1.5: the gaps of a dash take half the ink away, and this is the
  // state that needs the human — it must not read weaker than "running".
  if (status === "waiting") return { border: `2px dashed ${AMBER}`, pulse: false };
  if (status === "escalated") return { border: `1.5px solid ${AMBER}`, pulse: false };
  if (status === "running") {
    return { border: `1.5px solid var(--primary)`, pulse: true };
  }
  if (colorMode === "type" && kind) return { border: `1px solid ${KIND_COLOR[kind]}`, pulse: false };
  return { border: `1px solid var(--border)`, pulse: false };
}

export function NodeCard({
  label,
  subtitle,
  status,
  kind,
  colorMode = "status",
  icon,
  selected = false,
  onClick,
  dimmed = false,
}: NodeCardProps) {
  ensurePulseStyles();
  const { border, pulse } = borderFor(status, kind, colorMode);
  return (
    <button
      type="button"
      aria-label={subtitle ? `${label} — ${subtitle}` : label}
      aria-pressed={selected}
      aria-disabled={dimmed}
      onClick={dimmed ? undefined : onClick}
      className={pulse ? PULSE_CLASS : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: "100%",
        padding: "6px 10px",
        borderRadius: 10,
        border,
        outline: selected ? "2px solid var(--primary)" : "none",
        outlineOffset: 1,
        background: "var(--card)",
        color: "var(--foreground)",
        textAlign: "left",
        cursor: dimmed ? "default" : "pointer",
        opacity: dimmed ? 0.35 : 1,
        // React Flow marks a non-selectable, non-draggable node's own wrapper
        // `pointer-events: none` — an optimization that, left alone, blocks
        // every click reaching the card inside it too, since the CSS property
        // inherits down through descendants. A dimmed card locks the same way
        // on purpose: outside the frame being edited, nothing is selectable.
        pointerEvents: dimmed ? "none" : "auto",
      }}
    >
      {icon ? (
        <span aria-hidden style={{ display: "flex", flexShrink: 0 }}>
          {icon}
        </span>
      ) : null}
      <span style={{ display: "flex", minWidth: 0, flexDirection: "column", flex: 1 }}>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {label}
        </span>
        {subtitle ? (
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 11,
              color: "var(--muted-foreground)",
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
      {status ? (
        <span
          aria-hidden
          title={status}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            flexShrink: 0,
            background: "var(--muted-foreground)",
          }}
        />
      ) : null}
    </button>
  );
}
