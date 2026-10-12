// Details of the selected node. Part 1 shows what a provider put in `meta` —
// a chat or replay feed for `thread`/`turn` nodes is a later ticket, once
// there is a timeline to lazily load into this same slot.
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { clampWidth, DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH } from "../lib/clampWidth";
import type { CanvasNode } from "../lib/types";

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

export type SidebarProps = {
  node: CanvasNode;
  onClose: () => void;
};

export function Sidebar({ node, onClose }: SidebarProps) {
  const meta = Object.entries(node.meta ?? {});
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
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{node.label}</div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{node.kind}</div>
        </div>
        <button type="button" aria-label="Close details" onClick={onClose} style={{ cursor: "pointer" }}>
          ×
        </button>
      </div>
      {meta.length > 0 ? (
        <dl style={{ margin: 0, fontSize: 12, display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px" }}>
          {meta.map(([key, value]) => (
            <div key={key} style={{ display: "contents" }}>
              <dt style={{ color: "var(--muted-foreground)" }}>{key}</dt>
              <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </aside>
  );
}
