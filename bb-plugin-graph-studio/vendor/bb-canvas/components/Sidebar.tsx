// Details of the selected node. Part 1 shows what a provider put in `meta` —
// a chat or replay feed for `thread`/`turn` nodes is a later ticket, once
// there is a timeline to lazily load into this same slot.
import type { CanvasNode } from "../lib/types";

export type SidebarProps = {
  node: CanvasNode;
  onClose: () => void;
};

export function Sidebar({ node, onClose }: SidebarProps) {
  const meta = Object.entries(node.meta ?? {});
  return (
    <aside
      aria-label={`Details for ${node.label}`}
      style={{
        width: 260,
        flexShrink: 0,
        borderLeft: "1px solid var(--border)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
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
