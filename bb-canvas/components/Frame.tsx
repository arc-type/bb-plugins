// A plain box behind a group of node cards — no state, no interaction. Where
// a frame's members sit inside it (lead above, members below, …) is the
// calling plugin's concern, decided by the order it hands nodes to
// `layoutTree`; this component only draws the rectangle `layoutTree` placed.
export type FrameProps = {
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function Frame({ label, x, y, width, height }: FrameProps) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        // Behind every NodeCard, which React Flow stacks in render order —
        // frames are appended to the node list ahead of the cards they hold.
        zIndex: 0,
        borderRadius: 12,
        border: "1px dashed var(--border)",
        pointerEvents: "none",
      }}
    >
      {label ? (
        <span
          style={{
            position: "absolute",
            top: -9,
            left: 10,
            padding: "0 6px",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--muted-foreground)",
            background: "var(--background)",
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
