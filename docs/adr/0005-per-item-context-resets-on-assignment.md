# 5. Per-item context starts the new shift on assignment, not on claim

Date: 2026-10-13 · Status: accepted · Ticket: BBP-104

## Context
A reviewer that keeps its context across work items carries earlier
candidates and discussions into every later review and is no longer
independent. BBP-104 adds a member option `context: per-item`. The ticket
suggested a reset "before each newly claimed work item", but a member claims
inside its own turn: clearing its context there would cut off the very turn
that claimed the item.

## Decision
- For a member with `context: per-item`, the shift change happens when a work
  item is assigned to it (create with owner, handoff), before the notice is
  delivered: the old shift ends like `reset --mode new` (BBP-268), and the
  new thread starts with kickoff brief + the work-item notice as its first
  prompt.
- No reset while the member still owns a claimed, unfinished item; the new
  item then waits as a normal message, and the fresh shift starts with the
  next assignment after that.
- Default stays `persistent`; existing crews and crew files are unchanged.

## Consequences
- Two items in a row give two shifts with an empty context, without any
  action by the member.
- A per-item member can no longer be asked follow-up questions about an
  earlier item from memory; everything it needs must be in the work item.
