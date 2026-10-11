# 1. Loading locked skills in graph and crew workers

Date: 2026-10-11 · Status: accepted · Ticket: BBP-137

## Context
Graph Studio (`composeNodePrompt`, `composeDialogPrompt`) and Crew
(`lib/agent.ts`) only *named* skills. Locked skills (see GLOSSARY.md) then fail
with "cannot be used with Skill tool due to disable-model-invocation".

Probe on 2026-10-11, Claude Code in BB worker threads:
- `/to-spec …` as the first prompt of a new thread: skill text loaded.
- `/to-spec …` or `/grill-with-docs …` as a follow-up (`bb thread tell`): not loaded.

## Decision
- **Graph Studio: slash invocation.** Each node runs in a new thread. The first
  locked skill of a node prefixes the prompt as `/<skill>`. All other skills
  stay a name hint. If a node has more than one locked skill, graph validation
  rejects the graph on save and says why.
- **Crew: skill injection.** Members get their work as follow-up messages
  (`[crew] From: …`), so slash invocation is not possible there. The crew plugin
  puts the SKILL.md text of each member skill into the member instructions.
  The human chose these skills in crew.yaml; that is the user invocation the
  flag protects.

## Consequences
- No local copies, so no drift from upstream skills.
- Graph nodes carry at most one locked skill.
- Crew instructions grow by the size of the injected SKILL.md files.
