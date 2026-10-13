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

**Project filter** — the canvas toolbar's choice of which projects it shows. An
empty selection means *all* projects; "Clear selection" returns to that state.

**Searchable multi-select** — a dropdown list of options with a search field,
checkboxes and keyboard control. Ticked options stay on top even when they do
not match the search. The project filter is one; the Focus dropdown is to be
another.

**Shift** — one stretch of work by a crew member between two resets. A reset
starts a new shift; reports from an earlier shift are out of date.

**Kickoff brief** — the first message of a shift: the member's role, peers and
messaging rules. After a reset it waits until the member's next real message
and travels with it, so a reset alone never starts work.

**Child-completed notice** — the message BB itself sends to a parent thread
whenever a child thread finishes a turn. It is not a crew message. Crew members
are not child threads of their lead, so the lead does not get these notices.

**Member key** — a member's name inside its crew; the address is
`<member key>@<crew>`. By default the key is `<group>-<member>`
(`orch-lead`); with short keys it is the member id alone (`lead`), and member
ids must then be unique across all groups of the crew.

**Rename (crew plan)** — a member whose key changes while it stays the same
member (same group and id). It keeps its thread and history instead of being
removed and spawned again.

**Drift (crew)** — an instance whose stored crew file no longer matches the
crew file it is compared against (its template): members added or removed,
or a member's provider or model changed. The crew file version is a
per-crew counter and is not compared across crews.

**Crew section** — the sidebar thread section named after a crew that holds
its lead and member threads. It replaces grouping by parent thread, since
members have no parent. Removing the crew removes the section; the threads
stay.
