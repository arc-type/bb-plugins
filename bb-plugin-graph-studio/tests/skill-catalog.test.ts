import { describe, expect, it } from "vitest";
import { resolveSkillCatalog, type SkillsFs } from "../lib/skill-catalog";

function fakeFs(files: Record<string, string>): SkillsFs {
  return {
    readdir: async (path) => {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const seen = new Set<string>();
      for (const file of Object.keys(files)) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        const entry = rest.split("/")[0];
        if (entry) seen.add(entry);
      }
      if (seen.size === 0) throw new Error(`ENOENT: ${path}`);
      return [...seen];
    },
    readFile: async (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
  };
}

const frontmatter = (name: string, locked?: boolean) =>
  `---\nname: ${name}\ndescription: test${locked ? "\ndisable-model-invocation: true" : ""}\n---\n\nBody.`;

describe("resolveSkillCatalog", () => {
  it("positive: reports a locked skill (disable-model-invocation: true) as locked", async () => {
    const fs = fakeFs({ "/home/.bb/skills/to-spec/SKILL.md": frontmatter("to-spec", true) });
    const catalog = await resolveSkillCatalog({ homeDir: "/home", projectPath: null }, fs);
    expect(catalog.get("to-spec")).toBe(true);
  });

  it("positive: reports a skill without the flag as not locked", async () => {
    const fs = fakeFs({ "/home/.bb/skills/pr/SKILL.md": frontmatter("pr") });
    const catalog = await resolveSkillCatalog({ homeDir: "/home", projectPath: null }, fs);
    expect(catalog.get("pr")).toBe(false);
  });

  it("positive: finds skills under global and project roots, both .bb and .claude", async () => {
    const fs = fakeFs({
      "/home/.bb/skills/memory/SKILL.md": frontmatter("memory"),
      "/home/.bb/skills-generated/to-tickets/SKILL.md": frontmatter("to-tickets", true),
      "/home/.claude/skills/tdd/SKILL.md": frontmatter("tdd"),
      "/repo/.bb/skills/local-thing/SKILL.md": frontmatter("local-thing"),
      "/repo/.claude/skills/repo-only/SKILL.md": frontmatter("repo-only", true),
    });
    const catalog = await resolveSkillCatalog({ homeDir: "/home", projectPath: "/repo" }, fs);
    expect([...catalog.keys()].sort()).toEqual(["local-thing", "memory", "repo-only", "tdd", "to-tickets"]);
    expect(catalog.get("to-tickets")).toBe(true);
    expect(catalog.get("repo-only")).toBe(true);
    expect(catalog.get("memory")).toBe(false);
  });

  it("negative: a missing frontmatter name falls back to the directory name and is not locked", async () => {
    const fs = fakeFs({ "/home/.bb/skills/gitlab/SKILL.md": "# Gitlab\n\nNo frontmatter here." });
    const catalog = await resolveSkillCatalog({ homeDir: "/home", projectPath: null }, fs);
    expect(catalog.get("gitlab")).toBe(false);
  });

  it("negative: projectPath null skips the project roots entirely", async () => {
    const fs = fakeFs({ "/repo/.bb/skills/local-thing/SKILL.md": frontmatter("local-thing", true) });
    const catalog = await resolveSkillCatalog({ homeDir: "/home", projectPath: null }, fs);
    expect(catalog.size).toBe(0);
  });

  it("negative: an entry without a SKILL.md is not a skill", async () => {
    const fs = fakeFs({ "/home/.bb/skills/not-a-skill/README.md": "nope" });
    const catalog = await resolveSkillCatalog({ homeDir: "/home", projectPath: null }, fs);
    expect(catalog.size).toBe(0);
  });

  it("negative: a missing root is skipped, not an error", async () => {
    const fs = fakeFs({});
    const catalog = await resolveSkillCatalog({ homeDir: "/home", projectPath: "/repo" }, fs);
    expect(catalog.size).toBe(0);
  });
});
