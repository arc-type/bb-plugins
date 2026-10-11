// Combines BB's own keyword search with qmd into one ranked result list, and
// describes every hit well enough to tell at a glance where it came from.

import { fuseRanked } from "./fuse.js";
import { normalizeId, parseDocFileName } from "./mirror.js";
import type { QmdHit, QmdMode } from "./qmd.js";
import { QMD_COLLECTION } from "./qmd.js";
import { plainSnippet } from "./snippet.js";

export type HitKind = "thread" | "task" | "file";

export interface RecallHit {
  key: string;
  kind: HitKind;
  /** Thread id, task id, or absolute file path. */
  id: string;
  title: string;
  snippet: string;
  /** Which engines found the hit; both means it was confirmed twice. */
  via: ("keyword" | "semantic")[];
  /** Human-readable origin: "Thread", "Task", or the folder's label. */
  source: string;
  /** Where inside the source: project name, task key and status, or folder path. */
  context: string | null;
  /** Last change in ms, when known. */
  updatedAt: number | null;
}

export interface ThreadInfo {
  title: string;
  projectName: string | null;
  updatedAt: number;
}

export interface TaskInfo {
  key: string;
  title: string;
  status: string;
  updatedAt: number;
}

export interface FolderInfo {
  collection: string;
  root: string;
  label: string;
  resolve(reportedPath: string): string | null;
}

/** What the server knows about indexed objects; rebuilt on every index pass. */
export interface Catalog {
  thread(id: string): ThreadInfo | null;
  task(id: string): TaskInfo | null;
  /** Real id for a qmd-normalized one. */
  resolve(kind: "thread" | "task", normalizedId: string): string | null;
  folders: readonly FolderInfo[];
}

export function buildCatalog(
  threads: ReadonlyMap<string, ThreadInfo>,
  tasks: ReadonlyMap<string, TaskInfo>,
  folders: readonly FolderInfo[],
): Catalog {
  const normalized = {
    thread: new Map([...threads.keys()].map((id) => [normalizeId(id), id])),
    task: new Map([...tasks.keys()].map((id) => [normalizeId(id), id])),
  };
  return {
    thread: (id) => threads.get(id) ?? null,
    task: (id) => tasks.get(id) ?? null,
    resolve: (kind, id) => normalized[kind].get(normalizeId(id)) ?? null,
    folders,
  };
}

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  canceled: "Canceled",
};

function describeThread(id: string, fallbackTitle: string, catalog: Catalog) {
  const info = catalog.thread(id);
  return {
    title: info?.title || fallbackTitle || id,
    source: "Thread",
    context: info?.projectName ?? null,
    updatedAt: info?.updatedAt ?? null,
  };
}

function describeTask(id: string, fallbackTitle: string, catalog: Catalog) {
  const info = catalog.task(id);
  if (!info) return { title: fallbackTitle || id, source: "Task", context: null, updatedAt: null };
  return {
    title: info.title,
    source: "Task",
    context: `${info.key} · ${STATUS_LABELS[info.status] ?? info.status}`,
    updatedAt: info.updatedAt,
  };
}

export interface KeywordThreadHit {
  threadId: string;
  title: string;
  snippet: string;
}

export function hitsFromKeyword(results: readonly KeywordThreadHit[], catalog: Catalog): RecallHit[] {
  return results.map((result) => ({
    key: `thread:${result.threadId}`,
    kind: "thread",
    id: result.threadId,
    snippet: plainSnippet(result.snippet),
    via: ["keyword"],
    ...describeThread(result.threadId, result.title, catalog),
  }));
}

/** Splits "qmd://<collection>/<path>?index=…" into its parts. */
export function parseQmdFile(file: string): { collection: string; path: string } | null {
  const match = /^qmd:\/\/([^/]+)\/([^?]*)/.exec(file);
  return match ? { collection: match[1], path: decodeURIComponent(match[2]) } : null;
}

/** Drops hits from unknown collections, foreign files, and objects that are gone. */
export function hitsFromQmd(hits: readonly QmdHit[], catalog: Catalog): RecallHit[] {
  return hits.flatMap((hit): RecallHit[] => {
    const parsed = parseQmdFile(hit.file);
    if (!parsed) return [];
    const snippet = plainSnippet(hit.snippet);
    if (parsed.collection === QMD_COLLECTION) {
      const doc = parseDocFileName(parsed.path);
      if (!doc) return [];
      const id = catalog.resolve(doc.kind, doc.id);
      if (!id) return [];
      const described =
        doc.kind === "thread" ? describeThread(id, hit.title, catalog) : describeTask(id, hit.title, catalog);
      return [{ key: `${doc.kind}:${id}`, kind: doc.kind, id, snippet, via: ["semantic"], ...described }];
    }
    const folder = catalog.folders.find((entry) => entry.collection === parsed.collection);
    if (!folder) return [];
    const relativePath = folder.resolve(parsed.path);
    if (!relativePath) return [];
    const path = `${folder.root}/${relativePath}`;
    const directory = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : null;
    return [
      {
        key: `file:${path}`,
        kind: "file",
        id: path,
        title: hit.title || relativePath.split("/").pop() || relativePath,
        snippet,
        via: ["semantic"],
        source: folder.label,
        context: directory,
        updatedAt: null,
      },
    ];
  });
}

/** qmd chunks one document into several hits; keep the best-ranked one per document. */
function firstPerKey(hits: readonly RecallHit[]): RecallHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => (seen.has(hit.key) ? false : (seen.add(hit.key), true)));
}

export function combine(
  keyword: readonly RecallHit[],
  semantic: readonly RecallHit[],
  limit: number,
): RecallHit[] {
  const semanticByKey = new Map(semantic.map((hit) => [hit.key, hit]));
  return fuseRanked([firstPerKey(keyword), firstPerKey(semantic)], limit).map(
    ({ fusedScore: _score, sources, ...hit }) => {
      if (sources < 2) return hit;
      // Keep BB's highlighted snippet and title; mark the hit as found by both.
      return {
        ...hit,
        via: ["keyword", "semantic"] as RecallHit["via"],
        snippet: hit.snippet || semanticByKey.get(hit.key)?.snippet || "",
      };
    },
  );
}

export type SearchMode = QmdMode;
