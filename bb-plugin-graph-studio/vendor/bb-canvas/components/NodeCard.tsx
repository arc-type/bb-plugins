// The one card shape every `CanvasNode` kind renders as. A navigation tree
// with a different card per kind drifts the moment one of them gets a new
// field and the others do not — one shape, and the kind says itself through
// the label and the icon slot the caller fills in.
//
// Status is a neutral dot in this package: colour by status is BBP-146, once
// the view it feeds exists to judge the colours against.
import type { ReactNode } from "react";
import type { CanvasStatus } from "@/lib/types";

export type NodeCardProps = {
  label: string;
  subtitle?: string;
  status?: CanvasStatus;
  /** A single-colour line icon, left of the label. */
  icon?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
};

export function NodeCard({ label, subtitle, status, icon, selected = false, onClick }: NodeCardProps) {
  return (
    <button
      type="button"
      aria-label={subtitle ? `${label} — ${subtitle}` : label}
      aria-pressed={selected}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: "100%",
        padding: "6px 10px",
        borderRadius: 10,
        border: `1px solid ${selected ? "var(--primary)" : "var(--border)"}`,
        background: "var(--card)",
        color: "var(--foreground)",
        textAlign: "left",
        cursor: "pointer",
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
