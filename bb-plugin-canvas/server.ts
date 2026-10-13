// bb-plugin-canvas — backend entry.
//
// The page reads threads and projects straight from the SDK in the frontend;
// the backend only declares the overview window's settings (BBP-287, same
// names and ranges as agent-graph), which the page reads with useSettings.
// `lib/notify.ts` (canvas.notify, SDK >= 0.6.15) is wired in once extensions
// push their layers (FT4/FT5).
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function canvas(bb: BbPluginApi) {
  bb.settings.define({
    windowHours: {
      type: "number",
      label: "Overview window (hours)",
      description: "Threads updated within this many hours, 1–720. Running, waiting and failed threads always show.",
      default: 12,
    },
    maxThreads: {
      type: "number",
      label: "Threads in the overview",
      description: "At most this many threads, newest first, 1–100.",
      default: 20,
    },
    overviewTurns: {
      type: "number",
      label: "Turns per thread",
      description: "The newest turns an opened thread shows, 0–10.",
      default: 1,
    },
  });
}
