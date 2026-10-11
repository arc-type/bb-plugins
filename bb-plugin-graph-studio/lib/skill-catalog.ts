// Locked-skill catalog for graph nodes (BBP-137/BBP-157).
//
// A skill is "locked" when its SKILL.md frontmatter sets
// `disable-model-invocation: true` (see GLOSSARY.md). composeNodePrompt and
// validateGraph need to know, per skill name, whether it is locked, so the
// worker prompt can prefix `/<skill>` instead of only naming it. Scans the
// same roots as crew's resolveSkillsCatalog (lib/skills.ts in
// bb-plugin-crew); filesystem access is injected so this stays testable
// without touching disk.
import { readdir as nodeReaddir, readFile as nodeReadFile } from "node:fs/promises";
import { join } from "node:path";

export type SkillsFs = {
  readdir: (path: string) => Promise<string[]>;
  readFile: (path: string) => Promise<string>;
};

export const nodeSkillsFs: SkillsFs = {
  readdir: (path) => nodeReaddir(path),
  readFile: (path) => nodeReadFile(path, "utf8"),
};

export type SkillsRoots = {
  /** The user's home directory; global roots are `<homeDir>/.bb/skills`, `<homeDir>/.bb/skills-generated` and `<homeDir>/.claude/skills`. */
  homeDir: string;
  /** The project's local checkout path; its roots are `<projectPath>/.bb/skills` and `<projectPath>/.claude/skills`. Null skips them. */
  projectPath: string | null;
};

/** Skill name to whether it is locked (`disable-model-invocation: true`). */
export type SkillCatalog = Map<string, boolean>;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

/** A top-level `key: value` scalar from a YAML frontmatter block, read without a YAML parser since only two flat fields are ever needed here. */
function frontmatterField(front: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front);
  return match?.[1]?.trim();
}

/** The resolved name and locked flag of `<dir>/SKILL.md`, or null when there is no SKILL.md there. */
async function readSkill(fs: SkillsFs, dir: string, fallback: string): Promise<{ name: string; locked: boolean } | null> {
  let content: string;
  try {
    content = await fs.readFile(join(dir, "SKILL.md"));
  } catch {
    return null;
  }
  const match = FRONTMATTER.exec(content);
  if (!match) return { name: fallback, locked: false };
  const front = match[1]!;
  const rawName = frontmatterField(front, "name");
  const name = rawName && rawName.trim() !== "" ? rawName.trim() : fallback;
  const locked = frontmatterField(front, "disable-model-invocation") === "true";
  return { name, locked };
}

/** One root's immediate subdirectories that hold a SKILL.md, by resolved name and locked flag. */
async function scanRoot(fs: SkillsFs, root: string, into: SkillCatalog): Promise<void> {
  const entries = await fs.readdir(root).catch(() => []);
  for (const entry of entries) {
    const skill = await readSkill(fs, join(root, entry), entry);
    if (skill) into.set(skill.name, skill.locked);
  }
}

/** All skill names known here, mapped to whether each is locked: global (~/.bb/skills, ~/.bb/skills-generated, ~/.claude/skills) and project (<projectPath>/.bb/skills, <projectPath>/.claude/skills). */
export async function resolveSkillCatalog(roots: SkillsRoots, fs: SkillsFs = nodeSkillsFs): Promise<SkillCatalog> {
  const dirs = [
    join(roots.homeDir, ".bb", "skills"),
    join(roots.homeDir, ".bb", "skills-generated"),
    join(roots.homeDir, ".claude", "skills"),
  ];
  if (roots.projectPath) dirs.push(join(roots.projectPath, ".bb", "skills"), join(roots.projectPath, ".claude", "skills"));
  const catalog: SkillCatalog = new Map();
  for (const dir of dirs) await scanRoot(fs, dir, catalog);
  return catalog;
}
