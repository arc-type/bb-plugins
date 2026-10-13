# bb-plugin-canvas

A **Canvas** nav entry for BB: every thread BB lists — chat threads included —
as one navigable tree under Agents → project → thread. Runs on its own; Crew
and Graph Studio are not required.

The canvas itself (layout, cards, sidebar) is the shared `bb-canvas` source,
vendored into `vendor/bb-canvas/` by `bash bb-canvas/scripts/sync.sh`;
`tests/vendor-drift.test.ts` fails when the copy and the source differ.

`lib/notify.ts` holds the `canvas.notify` prototype (SDK >= 0.6.15) for
extensions that push their own layers later.

```bash
npm install
npm test
npm run typecheck
```
