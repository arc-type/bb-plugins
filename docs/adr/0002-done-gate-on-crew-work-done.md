# 2. Done gate on crew_work_done

Date: 2026-10-12 · Status: accepted · Ticket: BBP-103

## Context
`crew_work_done` closed a work item without any check; quality relied on agent
judgement only. The crew file already has `checks`, a single crew-level
command guarding the integrator's merge into main.

## Decision
- **Separate field `gates.done`**, not an extension of `checks`: a done gate
  guards one work item per member, checks guard the merge.
- **Inheritance replaces, never concatenates:** member ?? group ?? crew, like
  `permissions`. `[]` on a member switches the gate off for that member.
- **Explicit confirmation:** gates run code, so a crew file with gates fails
  validation (`gates-unconfirmed`) unless applied with `--confirm-gates`. A
  field in the YAML does not count as confirmation.
- **Fail closed:** commands run in order, stop at the first red one (exit
  126/127 counts as red). Remote host or missing worktree refuses `done`
  instead of skipping the gate. No member bypass.
- **No new escalation and no new table:** a red gate keeps the item claimed
  (claimed→claimed transition with command, exit code, duration and trimmed
  output in the note); the existing follow-up ladder handles stuck items.

## Consequences
- Without `gates` nothing changes.
- Members on remote hosts cannot finish gated items until BBP-14.
- A broken gate command blocks the member until a human fixes the crew file.
