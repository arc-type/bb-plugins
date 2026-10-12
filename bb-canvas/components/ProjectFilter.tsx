// The toolbar's project multi-select (BBP-181). Nothing ticked means all
// projects, so the button never reads as an empty or broken filter.
import { useEffect, useRef, useState } from "react";
import type { ProjectOption } from "../lib/project-filter";

export type ProjectFilterProps = {
  projects: readonly ProjectOption[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
};

function summary(projects: readonly ProjectOption[], selected: readonly string[]): string {
  const chosen = projects.filter((project) => selected.includes(project.id));
  if (chosen.length === 0) return "All";
  if (chosen.length === 1) return chosen[0]!.name;
  return `${chosen.length} selected`;
}

export function ProjectFilter({ projects, selected, onChange }: ProjectFilterProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

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
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 10,
            minWidth: 200,
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
                {project.name}
              </label>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
