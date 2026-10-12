// The toolbar's project multi-select (BBP-181). Nothing ticked means all
// projects, so the button never reads as an empty or broken filter.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { placePopover } from "../lib/popover";
import type { ProjectOption } from "../lib/project-filter";

export type ProjectFilterProps = {
  projects: readonly ProjectOption[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
};

const POPOVER_WIDTH = 240;

function summary(projects: readonly ProjectOption[], selected: readonly string[]): string {
  const chosen = projects.filter((project) => selected.includes(project.id));
  if (chosen.length === 0) return "All";
  if (chosen.length === 1) return chosen[0]!.name;
  return `${chosen.length} selected`;
}

export function ProjectFilter({ projects, selected, onChange }: ProjectFilterProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ offset: number; width: number } | null>(null);

  // Measured on open: the canvas may sit in a slim panel, and the button's
  // spot in a wrapped toolbar is only known once laid out.
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const anchor = root.current.getBoundingClientRect();
    const canvas = root.current.closest("[data-canvas-view]")?.getBoundingClientRect();
    const bounds = canvas && canvas.width > 0 ? canvas : { left: 0, right: window.innerWidth };
    setPlace(placePopover(anchor, bounds, POPOVER_WIDTH));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id]);

  return (
    <div
      ref={root}
      style={{ position: "relative" }}
      // Keys typed in the list must not reach the canvas's own shortcuts.
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title="Choose which projects the canvas shows"
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
          <path d="M2 4h12l-4.5 5v4l-3-1.5V9z" />
        </svg>
        Projects: {summary(projects, selected)}
      </button>
      {open ? (
        <div
          role="group"
          aria-label="Projects"
          style={{
            position: "absolute",
            left: place?.offset ?? 0,
            top: "calc(100% + 4px)",
            zIndex: 10,
            width: place?.width ?? POPOVER_WIDTH,
            boxSizing: "border-box",
            maxHeight: 280,
            overflowY: "auto",
            padding: 4,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--popover, var(--card))",
            color: "var(--popover-foreground, var(--foreground))",
            fontSize: 12,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
          }}
        >
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={selected.length === 0}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "4px 8px",
              border: "none",
              background: "transparent",
              color: "var(--muted-foreground)",
              cursor: selected.length === 0 ? "default" : "pointer",
            }}
          >
            Show all
          </button>
          {projects.length === 0 ? (
            <div style={{ padding: "4px 8px", color: "var(--muted-foreground)" }}>No projects yet.</div>
          ) : (
            projects.map((project) => (
              <label key={project.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", cursor: "pointer" }}>
                <input type="checkbox" checked={selected.includes(project.id)} onChange={() => toggle(project.id)} />
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{project.name}</span>
              </label>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
