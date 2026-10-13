// The selected thread's full Activity list in the canvas sidebar (BBP-291,
// see BBP-264): every turn and row of its timeline, also the ones the turn
// limit keeps out of the canvas. Reloads whenever `version` changes (live).
import { useEffect, useState } from "react";
import type { useSdk } from "@get-bb/plugin-sdk/app";
import { activityList, type ActivityList } from "../vendor/bb-canvas/lib/activity";
import { threadNodeId, timelineToCanvas, type TimelineRowLike } from "../vendor/bb-canvas/lib/canvas-threads";
import { KindIcon } from "../vendor/bb-canvas/components/KindIcon";

export type ActivitySectionProps = {
  sdk: ReturnType<typeof useSdk>;
  threadId: string;
  turnsPerThread: number | null;
  version: number;
  onReveal: (nodeId: string, inCanvas: boolean) => void;
};

export function ActivitySection({ sdk, threadId, turnsPerThread, version, onReveal }: ActivitySectionProps) {
  const [list, setList] = useState<ActivityList | null>(null);
  useEffect(() => {
    let cancelled = false;
    // A failing or missing timeline just leaves the section out.
    Promise.resolve()
      .then(() => sdk.threads.timeline({ threadId }))
      .then(
        (response) => {
          if (cancelled) return;
          const { nodes } = timelineToCanvas(threadId, { rows: response.rows as unknown as readonly TimelineRowLike[] });
          setList(activityList(nodes, threadNodeId(threadId), turnsPerThread));
        },
        () => {
          if (!cancelled) setList(null);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [sdk, threadId, turnsPerThread, version]);

  if (list === null) return null;
  return (
    <section aria-label="Activity" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Activity
        <span className="font-normal normal-case tracking-normal">{list.header}</span>
      </div>
      <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
        {list.entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onReveal(entry.id, entry.inCanvas)}
              className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${entry.inCanvas ? "text-foreground" : "text-muted-foreground"}`}
            >
              <KindIcon kind={entry.kind} />
              <span className="truncate">{entry.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
