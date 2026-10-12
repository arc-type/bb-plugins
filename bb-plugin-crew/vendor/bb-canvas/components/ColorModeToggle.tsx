// The Status/Type colour-mode toggle (BBP-146) — one line icon, the current
// mode spelled out, so the toolbar never relies on an icon alone to say what
// a click changes.
export type ColorMode = "status" | "type";

export type ColorModeToggleProps = {
  mode: ColorMode;
  onToggle: () => void;
};

export function ColorModeToggle({ mode, onToggle }: ColorModeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Switch between colouring cards by run status or by node type"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--card)",
        color: "var(--foreground)",
        fontSize: 11,
        cursor: "pointer",
      }}
    >
      <svg
        aria-hidden
        width={12}
        height={12}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 2.5v11M2.5 8h11" />
      </svg>
      Colour: {mode === "status" ? "Status" : "Type"}
    </button>
  );
}
