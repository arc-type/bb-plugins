// Extra Markdown folders (an Obsidian vault, a docs tree) as search sources.
//
// Each folder becomes its own qmd collection named "folder-<slug>". qmd reports
// normalized paths ("90 Wiki/x.md" comes back as "90-Wiki/x.md"), so hits are
// mapped back through the list of real files gathered on every index pass.

import { readdir } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { normalizeId } from "./mirror.js";

export const FOLDER_PREFIX = "folder-";
const MAX_FILES_PER_FOLDER = 20_000;
const SKIP_DIRS = new Set([".git", ".obsidian", "node_modules", ".trash"]);

export interface FolderSource {
  /** qmd collection name. */
  collection: string;
  root: string;
  /** Shown in result rows, e.g. "brain". */
  label: string;
}

/** Parses the setting: one absolute path per line; blank lines and "#" comments are ignored. */
export function parseFolderSetting(value: string): { folders: FolderSource[]; invalid: string[] } {
  const folders: FolderSource[] = [];
  const invalid: string[] = [];
  const used = new Set<string>();
  for (const raw of value.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const root = line.replace(/\/+$/, "");
    if (!isAbsolute(root)) {
      invalid.push(line);
      continue;
    }
    const label = basename(root) || root;
    let collection = `${FOLDER_PREFIX}${normalizeId(label).replace(/^-|-$/g, "") || "root"}`;
    // Two folders with the same name still get distinct collections.
    for (let n = 2; used.has(collection); n += 1) collection = `${collection.replace(/-\d+$/, "")}-${n}`;
    used.add(collection);
    folders.push({ collection, root, label });
  }
  return { folders, invalid };
}

/** Lists Markdown files below root as paths relative to it. */
export async function listMarkdown(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (found.length >= MAX_FILES_PER_FOLDER) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        found.push(relative(root, join(dir, entry.name)));
        if (found.length >= MAX_FILES_PER_FOLDER) return;
      }
    }
  }
  await walk(root);
  return found;
}

/** Maps a qmd-reported relative path to a real one; null when the file is unknown. */
export function pathResolver(files: readonly string[]): (reported: string) => string | null {
  const byKey = new Map(files.map((file) => [normalizeId(file), file]));
  return (reported) => byKey.get(normalizeId(reported)) ?? null;
}
