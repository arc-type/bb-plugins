// Skill name resolution for crew.yaml's `skills: [...]` field (BBP-29).
//
// Names are matched against SKILL.md frontmatter under BB's roots (the two
// global directories in ~/.bb, `skills` and `skills-generated`, and the
// project's own `.bb/skills`) and Claude Code's (`~/.claude/skills`,
// `<project>/.claude/skills`): members running on claude-code load those too,
// so a name found only there is not "unknown". Filesystem access is injected
// so this stays testable without touching disk.
import { readdir as nodeReaddir, readFile as nodeReadFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import type { SkillsCatalog } from "./spec";

export type SkillsFs = {
  readdir: (path: string) => Promise<string[]>;
  readFile: (path: string) => Promise<string>;
};

export const nodeSkillsFs: SkillsFs = {
  readdir: (path) => nodeReaddir(path),
  readFile: (path) => nodeReadFile(path, "utf8"),
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

type SkillEntry = { name: string; body: string };

/** The resolved name and body (text without frontmatter) of `<dir>/SKILL.md`, or null when there is no SKILL.md there. */
async function readSkill(fs: SkillsFs, dir: string, fallback: string): Promise<SkillEntry | null> {
  let content: string;
  try {
    content = await fs.readFile(join(dir, "SKILL.md"));
  } catch {
    return null;
  }
  const match = FRONTMATTER.exec(content);
  const body = match ? content.slice(match[0].length).trim() : content.trim();
  if (match) {
    const front = YAML.parse(match[1]!) as { name?: unknown } | null;
    if (front && typeof front.name === "string" && front.name.trim() !== "") return { name: front.name.trim(), body };
  }
  return { name: fallback, body };
}

/** One root's immediate subdirectories that hold a SKILL.md, by their resolved name. */
async function scanRoot(fs: SkillsFs, root: string): Promise<SkillEntry[]> {
  const entries = await fs.readdir(root).catch(() => []);
  const skills: SkillEntry[] = [];
  for (const entry of entries) {
    const skill = await readSkill(fs, join(root, entry), entry);
    if (skill) skills.push(skill);
  }
  return skills;
}

export type SkillsRoots = {
  /** The user's home directory; global roots are `<homeDir>/.bb/skills`, `<homeDir>/.bb/skills-generated` and `<homeDir>/.claude/skills`. */
  homeDir: string;
  /** The project's local checkout path; its roots are `<projectPath>/.bb/skills` and `<projectPath>/.claude/skills`. Null skips them. */
  projectPath: string | null;
};

/** All skill names known here: global (~/.bb/skills, ~/.bb/skills-generated, ~/.claude/skills) and project (<projectPath>/.bb/skills, <projectPath>/.claude/skills). */
export async function resolveSkillsCatalog(roots: SkillsRoots, fs: SkillsFs = nodeSkillsFs): Promise<SkillsCatalog> {
  const dirs = [
    join(roots.homeDir, ".bb", "skills"),
    join(roots.homeDir, ".bb", "skills-generated"),
    join(roots.homeDir, ".claude", "skills"),
  ];
  if (roots.projectPath) dirs.push(join(roots.projectPath, ".bb", "skills"), join(roots.projectPath, ".claude", "skills"));
  const names = new Set<string>();
  const bodies = new Map<string, string>();
  for (const dir of dirs) {
    for (const skill of await scanRoot(fs, dir)) {
      names.add(skill.name);
      bodies.set(skill.name, skill.body);
    }
  }
  return { names, bodies };
}
