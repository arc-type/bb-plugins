# Real timeline fixtures (BBP-206 R2a)

`real-timeline-rows.json` holds representative `sdk.threads.timeline()` rows —
the shape `lib/canvas-threads.ts` (vendored into crew and graph-studio) actually maps, as
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
- `thr_sytz3rn8g6` — a Claude Code `steps-impl` worktree thread (plain user message, BBP-228)
- `thr_rqqw5vi4yw` — orch-lead@factory-1 (Claude Code; `[bb system]` child-completion notice, BBP-228)
- `thr_chzrjy3k4r` — "Rootline e2e integration test" (Pi; plain user message, BBP-228)
- `thr_rnty5wvb2j` — orch-lead@pipeline (Pi, `execution.model: "reuter/glm-big"`; `[bb system]` child-completion notice, BBP-228)

## Redactions

Absolute paths under `/Users/<user>/...` are replaced with
`/…/bb-plugins/...`; long command/tool output is trimmed to a representative
excerpt (`…` marks a cut); no credentials or tokens appeared in any sampled
event.

## BBP-228: request-kind × provider fixture matrix

`turnTitle()` and the thread-level request-to-turn assignment (`timelineToCanvas`)
are exercised against one fixture pair (a `"conversation"`/`role: "user"` row
plus its `"turn"` row) per request kind, for each provider:

- Crew message (`[crew] …`): `conversationUser`/`turnWithManySteps` (Claude
  Code, pre-existing) and `piConversationCrewMessage`/`piTurnCrewMessage` (Pi).
- Plain user message: `ccConversationUserMessage`/`ccTurnUserMessage` (Claude
  Code) and `piConversationUserMessage`/`piTurnUserMessage` (Pi).
- System message (`[bb system] …`): `ccConversationSystemMessage`/
  `ccTurnSystemMessage` (Claude Code) and `piConversationSystemMessage`/
  `piTurnSystemMessage` (Pi).

Every Pi conversation row above has `turnId: null` and relies on the
`sourceSeqStart`-order fallback (see `piThreadRequestFallback`) to reach its
turn — the Decisions on BBP-228 assume Pi omits `turnId` on this row, but
that is **not independently verified** (verifying it live would mean
reloading the plugin in the shared, already-installed BB app rather than
this worktree's own copy — the lead chose not to do that; see BBP-228's
review/decision comments). If that assumption turns out to be wrong, the
fallback path and these `turnId: null` fixtures should be revisited; until
then the fallback is harmless since it only engages when a row truly lacks a
`turnId`.

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
