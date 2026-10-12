# Real timeline fixtures (BBP-206 R2a)

`real-timeline-rows.json` holds representative `sdk.threads.timeline()` rows —
the shape `canvas-threads.ts` (crew and graph-studio) actually maps, as
documented in the "Timeline shape" comment on BBP-206.

## Why these aren't a raw dump

There is no `bb` CLI command or RPC that returns `sdk.threads.timeline()`'s
aggregated `TimelineRow[]` shape directly. `bb thread log <id> --json` returns
the *lower-level* raw event log (`item/completed` events with
`commandExecution`/`toolCall`/`fileRead`/`fileChange`/`agentMessage`/`reasoning`
items, `system/operation`, `system/thread-provisioning`, `provider/unhandled`,
…) — a different, pre-aggregation shape than the `TimelineRow` union the
canvas receives. The aggregation into `TimelineRow` happens server-side and
isn't independently exposed.

So each row here is built from the **authoritative schema** (the
`timeline*RowSchema` zod definitions bundled in
`@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts`, the exact package
`canvas-threads.ts` imports its types from) and populated with **real field
values** pulled from `bb thread log <id> --json --all` on the three source
threads below — commands, tool names, outputs, timestamps, titles. What is
*not* independently verified is the raw-event-to-TimelineRow aggregation
itself (e.g. exactly how a `system/operation` event's `message` becomes a
row's `detail` vs `title`); that mapping is inferred from the schema's field
names and the raw event's own fields, not observed directly.

## Sources

- `thr_5amv4jgf96` — concierge-lead@concierge (Claude Code)
- `thr_wyw9bnia2w` — steps-impl@factory-1 (Claude Code, this thread's own crew)
- `thr_m5hdus9gv4` — steps-impl@pipeline (Pi, eApp project)

## Redactions

Absolute paths under `/Users/<user>/...` are replaced with
`/…/bb-plugins/...`; long command/tool output is trimmed to a representative
excerpt (`…` marks a cut); no credentials or tokens appeared in any sampled
event.

## Key finding (see the "Timeline shape" comment on BBP-206 for the full
inventory)

The current mapping (`canvas-threads.ts`) treats every `work` row as having
one flat shape (`toolName`/`command`/`toolArgs`/`exitCode`/`output` all on
one object, discriminated only by `workKind: "tool"` vs `"delegation"`). The
real `TimelineWorkRow` is a **16-way discriminated union** on `workKind`
(`command`, `tool`, `file-change`, `web-search`, `web-fetch`,
`image-generation`, `image-view`, `file-read`, `search`, `plan-steps`,
`extension`, `approval`, `question`, `form`, `delegation`, `workflow`), and
the fields do **not** overlap the way the mapping assumes — e.g. a shell
command (`workKind: "command"`) has `command`/`exitCode`/`cwd`/`output` but
no `toolName`/`toolArgs`; an MCP/other tool call (`workKind: "tool"`) has
`toolName`/`toolArgs`/`output` but no `exitCode`/`command`; a file edit
(`workKind: "file-change"`) has a `change: {diff, diffStats, path, kind,
movePath}` object and `stdout`/`stderr`, not `output` at all. This fixture
set is scoped to the `workKind`s BBP-206 named as representative (`command`,
`tool`, `file-change`, `delegation`) plus `system` and `turn`/`conversation`
rows — not all 16.
