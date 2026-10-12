// Display formatting shared by the plugins that fill node `meta`, so a
// thread's and a run's times read the same in the sidebar.

/** Epoch milliseconds as "2026-10-12 08:53 UTC". UTC rather than local time
 *  so the value is the same in every test run and every viewer. A missing,
 *  zero, or invalid time is `undefined`, which `curateMeta` drops. */
export function formatTimestamp(ms: number | null | undefined): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return undefined;
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
