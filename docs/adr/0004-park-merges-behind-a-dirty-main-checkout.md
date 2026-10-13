# 4. Park merges behind a dirty main checkout

Date: 2026-10-13 · Status: accepted · Ticket: BBP-100

## Context
`crew_merge` / `bb crew approve` ran `git merge --no-ff` in the worktree that
has `main` checked out. With uncommitted changes there it failed or touched the
human's files. Moving `refs/heads/main` with `update-ref` under a checkout
leaves its index and files on the old commit: `git status` then shows the merge
as reverted changes, and the human's next commit undoes it.

## Decision
- The merge commit is always built without a worktree (`merge-tree
  --write-tree` + `commit-tree`). Conflict: nothing changes, `conflict: true`.
- Clean `main` checkout: `merge --ff-only` to the new commit. No checkout:
  `update-ref`.
- Dirty `main` checkout: `main` stays put; the commit goes to
  `refs/crew/integration/main` and the request gets the new state `parked`
  (not merged, no "main moved", no dependency release, lead on "Needs you"
  with reason `merge-parked`).
- Every later merge attempt and approve first releases the parked ref into
  `main` once the checkout is clean; all parked requests then become merged.
- Never `git stash`.

## Consequences
- A dirty checkout delays delivery instead of corrupting it; the human must
  commit or clean up to let it through.
- One more merge state that every consumer of merge states must know.
