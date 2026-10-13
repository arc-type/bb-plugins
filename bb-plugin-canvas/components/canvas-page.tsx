// The Canvas nav page (BBP-189): every thread BB lists, chat threads
// included, under Agents → its project. Reads the SDK directly — no crew or
// Graph Studio RPC — so it works with neither installed.
import { useEffect, useState } from "react";
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { CanvasView } from "../vendor/bb-canvas/components/CanvasView";
import { threadTree, type ProjectLike, type ThreadListItem } from "../vendor/bb-canvas/lib/thread-tree";
import type { CanvasLayer } from "../vendor/bb-canvas/lib/layer";

type State = { layer: CanvasLayer } | { error: string } | null;

export function CanvasPage(_props: { subPath?: string }) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [state, setState] = useState<State>(null);

  useEffect(() => {
    let cancelled = false;
    // An unreadable project list only costs the project names: the tree then
    // names each project by its id.
    const projects = sdk.projects.list().then(
      (list) => list.map((project): ProjectLike => ({ id: project.id, name: project.name ?? project.id })),
      () => [] as ProjectLike[],
    );
    Promise.all([projects, sdk.threads.list()]).then(
      ([projectList, threads]) => {
        if (!cancelled) setState({ layer: threadTree(projectList, threads as unknown as readonly ThreadListItem[]) });
      },
      (cause: unknown) => {
        if (!cancelled) setState({ error: cause instanceof Error ? cause.message : String(cause) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  if (state === null) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if ("error" in state) return <div className="p-4 text-sm text-destructive">Canvas not available: {state.error}</div>;
  if (state.layer.nodes.length === 0) return <div className="p-4 text-sm text-muted-foreground">No threads yet.</div>;
  return (
    <CanvasView
      nodes={state.layer.nodes}
      edges={state.layer.edges}
      initialExpanded={new Set(state.layer.expanded)}
      surface="canvas"
      onOpenThread={(threadId) => navigate.toThread(threadId)}
      className="h-full"
    />
  );
}
