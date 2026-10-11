// Merges ranked hit lists into one list.
//
// BB's keyword search and qmd's semantic search score on unrelated scales, so
// scores cannot be compared. Reciprocal rank fusion uses only each hit's rank
// in its own list: a document found by both rises, one found by a single
// source keeps its place relative to that source.

export interface RankedHit {
  /** Stable identity, e.g. "thread:thr_abc"; duplicates are merged on it. */
  key: string;
}

/** The usual RRF constant; it damps the gap between the first ranks. */
export const RRF_K = 60;

export function fuseRanked<T extends RankedHit>(
  lists: readonly (readonly T[])[],
  limit: number,
): (T & { fusedScore: number; sources: number })[] {
  const merged = new Map<string, { hit: T; score: number; sources: number }>();
  for (const list of lists) {
    const seen = new Set<string>();
    list.forEach((hit, rank) => {
      // A source listing a document twice must not count it twice.
      if (seen.has(hit.key)) return;
      seen.add(hit.key);
      const entry = merged.get(hit.key);
      const score = 1 / (RRF_K + rank + 1);
      if (entry) {
        entry.score += score;
        entry.sources += 1;
      } else {
        merged.set(hit.key, { hit, score, sources: 1 });
      }
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map(({ hit, score, sources }) => ({ ...hit, fusedScore: score, sources }));
}
