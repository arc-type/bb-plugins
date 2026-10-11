// One edge component for the three shapes `layoutTree` draws: `flow` along
// the tree, `back` bowing out to the right of its column, `message` as a
// plain dashed line (its pulse and counter land later, once there is
// traffic to show one for).
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import type { CanvasEdgeVariant } from "../lib/types";

export type StatusEdgeData = {
  variant: CanvasEdgeVariant;
  path: string;
  label: string;
};

export type StatusEdgeProps = EdgeProps & { data: StatusEdgeData };

const STROKE_DASHARRAY: Partial<Record<CanvasEdgeVariant, string>> = {
  message: "4 4",
};

export function StatusEdge({ data, selected }: StatusEdgeProps) {
  const [labelX, labelY] = midpoint(data.path);
  return (
    <>
      <BaseEdge
        path={data.path}
        style={{
          stroke: selected ? "var(--primary)" : "var(--border)",
          strokeWidth: selected ? 2 : 1.5,
          strokeDasharray: STROKE_DASHARRAY[data.variant],
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
