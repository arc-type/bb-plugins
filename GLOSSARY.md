# Glossary

**Locked skill** — a skill whose SKILL.md sets `disable-model-invocation: true`.
The model cannot load it through the Skill tool; only the user can, by typing
`/<skill>`. Examples: `to-spec`, `to-tickets`, `implement-spec`,
`grill-with-docs`, `retro`.

**Slash invocation** — a worker thread's *first* prompt starts with
`/<skill> …`. Claude Code then loads the skill as a user invocation, which also
works for locked skills. It does not work in follow-up messages.

**Skill injection** — a plugin reads a skill's SKILL.md and puts its text into
the agent's instructions instead of only naming the skill.

**Done gate** — commands from the crew file (`gates.done`) that must all exit 0
in the member's worktree before `crew_work_done` closes a work item. A red gate
leaves the item claimed. Not the same as **checks**, which guard the merge of a
crew branch into main.

**Checks** — the crew's single command that must be green before the
integrator merges a crew branch into main.
