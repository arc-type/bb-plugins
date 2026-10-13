// The Canvas toolbar filters (BBP-189 AK 4). Controlled: the page owns the
// `ThreadFilter` and applies it with `filterThreads`.
import type { CSSProperties } from "react";
import { ProjectFilter } from "../vendor/bb-canvas/components/ProjectFilter";
import { SearchableMultiSelect } from "../vendor/bb-canvas/components/SearchableMultiSelect";
import type { ProjectOption } from "../vendor/bb-canvas/lib/project-filter";
import type { ThreadFilter } from "../vendor/bb-canvas/lib/thread-filter";
import type { CanvasStatus } from "../vendor/bb-canvas/lib/types";

const HOUR = 3_600_000;
const WINDOWS: { value: string; label: string; ms: number | null }[] = [
  { value: "all", label: "Any time", ms: null },
  { value: "1h", label: "Last hour", ms: HOUR },
  { value: "24h", label: "Last 24 hours", ms: 24 * HOUR },
  { value: "7d", label: "Last 7 days", ms: 7 * 24 * HOUR },
  { value: "30d", label: "Last 30 days", ms: 30 * 24 * HOUR },
];

const STATUSES: { id: CanvasStatus; name: string }[] = [
  { id: "running", name: "Running" },
  { id: "idle", name: "Idle" },
  { id: "failed", name: "Failed" },
];

const CONTROL: CSSProperties = {
  font: "inherit",
  fontSize: 11,
  padding: "2px 8px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--card)",
  color: "var(--foreground)",
};

// Label text is secondary to the value it names, like the pills' "Projects:".
const FIELD: CSSProperties = { display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--muted-foreground)" };

/** Empty or non-positive input means "no limit", never a canvas of zero. */
function parseLimit(raw: string): number | null {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export type CanvasFiltersProps = {
  projects: readonly ProjectOption[];
  filter: ThreadFilter;
  onChange: (filter: ThreadFilter) => void;
};

export function CanvasFilters({ projects, filter, onChange }: CanvasFiltersProps) {
  const set = (patch: Partial<ThreadFilter>) => onChange({ ...filter, ...patch });
  const windowValue = WINDOWS.find((entry) => entry.ms === filter.windowMs)?.value ?? "all";
  return (
    <>
      <ProjectFilter projects={projects} selected={filter.projectIds} onChange={(projectIds) => set({ projectIds })} />
      <SearchableMultiSelect
        label="Status"
        options={STATUSES}
        selected={filter.statuses}
        onChange={(ids) => set({ statuses: ids as CanvasStatus[] })}
        emptyText="No statuses."
      />
      <select
        aria-label="Time window"
        value={windowValue}
        onChange={(event) => set({ windowMs: WINDOWS.find((entry) => entry.value === event.target.value)?.ms ?? null })}
        style={CONTROL}
      >
        {WINDOWS.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.label}
          </option>
        ))}
      </select>
      <label style={FIELD}>
        Threads
        <input
          type="number"
          min={1}
          aria-label="Thread limit"
          value={filter.limit ?? ""}
          onChange={(event) => set({ limit: parseLimit(event.target.value) })}
          style={{ ...CONTROL, width: 48 }}
        />
      </label>
      <label style={FIELD}>
        Turns
        <input
          type="number"
          min={1}
          aria-label="Turns per thread"
          value={filter.turnsPerThread ?? ""}
          onChange={(event) => set({ turnsPerThread: parseLimit(event.target.value) })}
          style={{ ...CONTROL, width: 48 }}
        />
      </label>
      <label style={FIELD}>
        <input
          type="checkbox"
          aria-label="Hide archived"
          checked={filter.hideArchived}
          onChange={(event) => set({ hideArchived: event.target.checked })}
          style={{ margin: 0, accentColor: "var(--primary)" }}
        />
        Hide archived
      </label>
    </>
  );
}
