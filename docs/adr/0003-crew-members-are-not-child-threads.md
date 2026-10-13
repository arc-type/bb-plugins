# 3. Crew members are not child threads of the lead

Date: 2026-10-13 · Status: accepted · Ticket: BBP-217

## Context
Member threads were created with the lead's thread as `parentThreadId`, so the
sidebar nested them under the lead. BB then posts a `child-completed` notice to
the lead after every member turn. The member's `crew_send` report already
covers that turn, so the lead woke up twice. After `crew_reset --mode clear`,
the old shift's turn end also reached the lead as a stale notice. On
orch-lead@factory-1, 51 % of incoming lead turns were these notices. The
plugin SDK has no switch to turn them off and no hook to filter or mark
messages before delivery.

## Decision
- Members are created without `parentThreadId`. Sync detaches existing member
  threads (parent → null). Only the lead has no parent, as before.
- Stale notices get no marking of their own: without a parent there are none.
- Deleting a crew walks the member bindings in the crew's metadata instead of
  the thread's children.

## Consequences
- The sidebar no longer groups member threads under their lead.
- The lead learns about a member's turn only from crew messages, so a member
  that ends a turn without `crew_send` stays silent. The follow-up ladder for
  work items still applies.
- Reverting this brings the double and stale notices back.
