// bb-plugin-canvas — backend entry.
//
// The page reads threads and projects straight from the SDK in the frontend,
// so the backend has nothing to serve yet. `lib/notify.ts` (canvas.notify,
// SDK >= 0.6.15) is wired in once extensions push their layers (FT4/FT5).
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function canvas(_bb: BbPluginApi) {}
