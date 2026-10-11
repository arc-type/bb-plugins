// Keeps the Markdown mirror in step with BB and tells qmd to re-index.
//
// One pass compares every thread's and task's updatedAt with the state of the
// previous pass and rewrites only what changed; deleted objects lose their
// file. qmd then hashes the mirror itself, so `update` and `embed` only touch
// changed documents. Sources and file access are injected for tests.

import {
  docFileName,
  parseDocFileName,
  renderTask,
  renderThread,
  type TaskDoc,
  type ThreadDoc,
} from "./mirror.js";

export interface ThreadSummary {
  id: string;
  projectId: string;
  title: string;
  updatedAt: number;
}

export interface IndexSources {
  listThreads(signal: AbortSignal): Promise<ThreadSummary[]>;
  threadMessages(threadId: string, signal: AbortSignal): Promise<ThreadDoc["messages"]>;
  /** null when tasks cannot be read right now; the previous task files then stay. */
  listTasks(signal: AbortSignal): Promise<TaskDoc[] | null>;
}

export interface MirrorFiles {
  list(): Promise<string[]>;
  write(name: string, content: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export interface IndexState {
  threads: Record<string, number>;
  tasks: Record<string, string>;
}

export interface PassResult {
  state: IndexState;
  written: number;
  removed: number;
  documents: number;
}

export const emptyState = (): IndexState => ({ threads: {}, tasks: {} });

export async function mirrorPass(
  sources: IndexSources,
  files: MirrorFiles,
  previous: IndexState,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<PassResult> {
  const [threads, tasks] = await Promise.all([
    sources.listThreads(signal),
    sources.listTasks(signal),
  ]);
  const state: IndexState = { threads: {}, tasks: {} };
  const wanted = new Set<string>();
  let written = 0;
  const changedThreads = threads.filter((thread) => previous.threads[thread.id] !== thread.updatedAt);
  const total = changedThreads.length;

  for (const thread of threads) {
    wanted.add(docFileName("thread", thread.id));
    // Unchanged threads keep their file and state without any fetch.
    if (previous.threads[thread.id] === thread.updatedAt) state.threads[thread.id] = thread.updatedAt;
  }
  for (const [index, thread] of changedThreads.entries()) {
    if (signal.aborted) break;
    const messages = await sources.threadMessages(thread.id, signal);
    await files.write(docFileName("thread", thread.id), renderThread({ ...thread, messages }));
    state.threads[thread.id] = thread.updatedAt;
    written += 1;
    onProgress?.(index + 1, total);
  }
  if (tasks === null) {
    for (const [id, updatedAt] of Object.entries(previous.tasks)) {
      wanted.add(docFileName("task", id));
      state.tasks[id] = updatedAt;
    }
  }
  for (const task of tasks ?? []) {
    const name = docFileName("task", task.id);
    wanted.add(name);
    if (previous.tasks[task.id] !== task.updatedAt) {
      await files.write(name, renderTask(task));
      written += 1;
    }
    state.tasks[task.id] = task.updatedAt;
  }

  let removed = 0;
  if (!signal.aborted) {
    for (const name of await files.list()) {
      // Only files the mirror itself names are ever deleted.
      if (parseDocFileName(name) && !wanted.has(name)) {
        await files.remove(name);
        removed += 1;
      }
    }
  }
  return { state, written, removed, documents: wanted.size };
}

/** Pulls the conversation text out of raw thread events. */
export function messagesFromEvents(events: readonly { type: string; data: unknown }[]): ThreadDoc["messages"] {
  const messages: ThreadDoc["messages"] = [];
  for (const event of events) {
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (event.type === "client/turn/requested") {
      const input = Array.isArray(data.input) ? data.input : [];
      const text = input
        .map((part) => {
          const record = (part ?? {}) as Record<string, unknown>;
          return record.type === "text" && typeof record.text === "string" ? record.text : "";
        })
        .filter(Boolean)
        .join("\n");
      if (text) messages.push({ role: "user", text });
    } else if (event.type === "item/completed") {
      const item = (data.item ?? {}) as Record<string, unknown>;
      if (item.type === "agentMessage" && typeof item.text === "string" && item.text.trim()) {
        messages.push({ role: "assistant", text: item.text });
      }
    }
  }
  return messages;
}
