// One edge component for the three shapes `layoutTree` draws: `flow` along
// the tree, `back` bowing out to the right of its column, `message` as a
// plain dashed line (its pulse and counter land later, once there is
// traffic to show one for) — and, since BBP-146, the two states any `flow`
// or `back` edge can carry: `taken` (solid primary) and `now` (the same,
// with a dash that travels along it).
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import type { CanvasEdgeState, CanvasEdgeVariant } from "../lib/types";

export type StatusEdgeData = {
  variant: CanvasEdgeVariant;
  path: string;
  label: string;
  state?: CanvasEdgeState;
};

export type StatusEdgeProps = EdgeProps & { data: StatusEdgeData };

const STROKE_DASHARRAY: Partial<Record<CanvasEdgeVariant, string>> = {
  message: "4 4",
};

const NOW_CLASS = "bb-canvas-edge-now";
const STYLE_ID = "bb-canvas-status-edge-styles";

/** Injected once, module-wide — React has no `@keyframes`. Reduced motion
 *  keeps the dash (so "now" still reads differently from "taken") but drops
 *  the travel. */
function ensureNowStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes ${NOW_CLASS} { to { stroke-dashoffset: -16; } }
    .${NOW_CLASS} { stroke-dasharray: 6 4; animation: ${NOW_CLASS} 0.6s linear infinite; }
    @media (prefers-reduced-motion: reduce) {
      .${NOW_CLASS} { animation: none; }
    }
  `;
  document.head.appendChild(style);
}

function strokeFor(state: CanvasEdgeState | undefined, selected: boolean | undefined): { stroke: string; strokeWidth: number } {
  if (state === "taken" || state === "now") return { stroke: "var(--primary)", strokeWidth: 2 };
  return { stroke: selected ? "var(--primary)" : "var(--border)", strokeWidth: selected ? 2 : 1.5 };
}

export function StatusEdge({ data, selected }: StatusEdgeProps) {
  ensureNowStyles();
  const [labelX, labelY] = midpoint(data.path);
  const { stroke, strokeWidth } = strokeFor(data.state, selected);
  return (
    <>
      <BaseEdge
        path={data.path}
        className={data.state === "now" ? NOW_CLASS : undefined}
        style={{
          stroke,
          strokeWidth,
          strokeDasharray: data.state ? undefined : STROKE_DASHARRAY[data.variant],
          fill: "none",
        }}
      />
      {data.label ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              fontSize: 10,
              color: "var(--muted-foreground)",
              background: "var(--card)",
              padding: "0 4px",
              borderRadius: 4,
              pointerEvents: "none",
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

/** The path's own midpoint, read from its end points — exact enough for a
 *  label, without re-deriving the curve's geometry here. */
function midpoint(path: string): [number, number] {
  const points = [...path.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map(
    (match) => [Number(match[1]), Number(match[2])] as const,
  );
  const first = points[0] ?? [0, 0];
  const last = points[points.length - 1] ?? first;
  return [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
}
