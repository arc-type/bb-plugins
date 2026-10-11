// Renders BB objects as Markdown documents for qmd.
//
// qmd indexes files, so every thread and task becomes one file under the
// plugin's data directory. A qmd hit is mapped back to its thread or task
// through the file name alone. There is no frontmatter: qmd would index it as
// text and show it in snippets.

export type DocKind = "thread" | "task";

export interface ThreadDoc {
  id: string;
  projectId: string;
  title: string;
  updatedAt: number;
  /** Conversation in order; tool output is deliberately left out. */
  messages: { role: "user" | "assistant"; text: string }[];
}

export interface TaskDoc {
  id: string;
  key: string;
  title: string;
  status: string;
  priority: string;
  description: string;
  updatedAt: string;
}

/** Caps one message so a pasted log cannot dominate a thread's embedding. */
export const MAX_MESSAGE_CHARS = 8_000;

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** File name for a document; ids are validated so no path can escape the mirror. */
export function docFileName(kind: DocKind, id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`invalid ${kind} id: ${id}`);
  return `${kind}-${id}.md`;
}

/**
 * qmd normalizes the paths it reports ("thr_abc" comes back as "thr-abc"), so
 * a reported name is compared through this key, never taken as the id itself.
 */
export function normalizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Inverse of docFileName up to qmd's normalization; null for foreign files. */
export function parseDocFileName(name: string): { kind: DocKind; id: string } | null {
  // qmd reports named-index files as "qmd://bb/thread-x.md?index=recall".
  const base = name.split("?")[0].split("/").pop() ?? "";
  const match = /^(thread|task)-([A-Za-z0-9_-]+)\.md$/.exec(base);
  return match ? { kind: match[1] as DocKind, id: match[2] } : null;
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_MESSAGE_CHARS
    ? `${trimmed.slice(0, MAX_MESSAGE_CHARS)} …`
    : trimmed;
}

/** One line per value; a newline in a title would break the frontmatter. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function renderThread(doc: ThreadDoc): string {
  const title = oneLine(doc.title) || doc.id;
  const body = doc.messages
    .filter((message) => message.text.trim() !== "")
    .map((message) => `## ${message.role === "user" ? "User" : "Assistant"}\n\n${clip(message.text)}`)
    .join("\n\n");
  return [
    `# ${title}`,
    "",
    body,
    "",
  ].join("\n");
}

export function renderTask(doc: TaskDoc): string {
  return [
    `# ${doc.key} ${oneLine(doc.title)}`,
    "",
    `Status: ${doc.status} · Priority: ${doc.priority}`,
    "",
    clip(doc.description),
    "",
  ].join("\n");
}
