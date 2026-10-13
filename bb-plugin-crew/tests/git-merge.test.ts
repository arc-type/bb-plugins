import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalGit } from "../lib/integration";

// BBP-269: GitBackend.merge against a real temporary repository with a crew worktree.
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "crew-merge-")));
  const main = join(root, "main");
  const wt = join(root, "wt");
  execFileSync("git", ["init", "-q", "-b", "main", main]);
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@t"], ["commit.gpgsign", "false"]]) git(main, "config", k!, v!);
  writeFileSync(join(main, "a.txt"), "a\n");
  writeFileSync(join(main, "b.txt"), "b\n");
  git(main, "add", ".");
  git(main, "commit", "-qm", "init");
  git(main, "worktree", "add", "-q", "-b", "bb/x", wt);
  return { main, wt };
}

function commit(cwd: string, file: string, text: string) {
  writeFileSync(join(cwd, file), text);
  git(cwd, "commit", "-qam", `edit ${file}`);
}

describe("GitBackend.merge without the working tree (BBP-269)", () => {
  it("clean main checkout: main is the new merge commit and the working tree equals HEAD", async () => {
    const { main, wt } = repo();
    commit(wt, "a.txt", "crew\n");
    const outcome = await createLocalGit().merge(wt, "bb/x", "main", "Merge bb/x");
    expect(outcome.ok).toBe(true);
    const sha = outcome.ok ? outcome.commit : "";
    expect(git(main, "rev-parse", "main")).toBe(sha);
    expect(git(main, "rev-parse", `${sha}^2`)).toBe(git(main, "rev-parse", "bb/x"));
    expect(git(main, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(main, "a.txt"), "utf8")).toBe("crew\n");
  });

  it("main moved ahead of the branch: still a merge commit with both parents", async () => {
    const { main, wt } = repo();
    commit(wt, "a.txt", "crew\n");
    commit(main, "b.txt", "human\n");
    const before = git(main, "rev-parse", "main");
    const outcome = await createLocalGit().merge(wt, "bb/x", "main", "Merge bb/x");
    expect(outcome.ok).toBe(true);
    expect(git(main, "rev-parse", "main^1")).toBe(before);
    expect(git(main, "status", "--porcelain")).toBe("");
  });

  it("nobody has main checked out: main moves by update-ref", async () => {
    const { main, wt } = repo();
    git(main, "switch", "-q", "--detach");
    commit(wt, "a.txt", "crew\n");
    const outcome = await createLocalGit().merge(wt, "bb/x", "main", "Merge bb/x");
    expect(outcome.ok).toBe(true);
    expect(git(main, "rev-parse", "main")).toBe(outcome.ok ? outcome.commit : "");
  });

  it("negative: a conflict changes neither main, the files nor the checkout", async () => {
    const { main, wt } = repo();
    commit(wt, "a.txt", "crew\n");
    commit(main, "a.txt", "human\n");
    const before = git(main, "rev-parse", "main");
    const outcome = await createLocalGit().merge(wt, "bb/x", "main", "Merge bb/x");
    expect(outcome).toMatchObject({ ok: false, conflict: true });
    expect(git(main, "rev-parse", "main")).toBe(before);
    expect(git(main, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(main, "a.txt"), "utf8")).toBe("human\n");
    expect(git(main, "stash", "list")).toBe("");
  });

  it("dirty main checkout: the merge is parked on refs/crew/integration/main, main and the files stay put (BBP-270)", async () => {
    const { main, wt } = repo();
    commit(wt, "a.txt", "crew\n");
    writeFileSync(join(main, "b.txt"), "wip\n");
    const before = git(main, "rev-parse", "main");
    const outcome = await createLocalGit().merge(wt, "bb/x", "main", "Merge bb/x");
    expect(outcome).toMatchObject({ ok: true, parked: true, checkout: main });
    expect(git(main, "rev-parse", "refs/crew/integration/main")).toBe(outcome.ok ? outcome.commit : "");
    expect(git(main, "rev-parse", "refs/crew/integration/main^1")).toBe(before);
    expect(git(main, "rev-parse", "main")).toBe(before);
    expect(readFileSync(join(main, "b.txt"), "utf8")).toBe("wip\n");
    expect(readFileSync(join(main, "a.txt"), "utf8")).toBe("a\n");
    expect(git(main, "stash", "list")).toBe("");
  });

  it("a second merge behind a dirty checkout builds on the parked ref, so it holds both commits (BBP-270)", async () => {
    const { main, wt } = repo();
    commit(wt, "a.txt", "crew\n");
    writeFileSync(join(main, "b.txt"), "wip\n");
    const first = await createLocalGit().merge(wt, "bb/x", "main", "Merge 1");
    git(main, "branch", "bb/y", "main");
    git(wt, "switch", "-q", "bb/y");
    writeFileSync(join(wt, "c.txt"), "second\n");
    git(wt, "add", "c.txt");
    git(wt, "commit", "-qm", "add c.txt");
    const second = await createLocalGit().merge(wt, "bb/y", "main", "Merge 2");
    expect(second).toMatchObject({ ok: true, parked: true });
    const ref = git(main, "rev-parse", "refs/crew/integration/main");
    expect(git(main, "rev-parse", `${ref}^1`)).toBe(first.ok ? first.commit : "");
    expect(git(main, "show", `${ref}:a.txt`)).toBe("crew");
    expect(git(main, "show", `${ref}:c.txt`)).toBe("second");
    expect(git(main, "stash", "list")).toBe("");
  });

  it("release after cleaning up: main fast-forwards to the parked commit, the checkout follows, the ref is gone (BBP-271)", async () => {
    const { main, wt } = repo();
    commit(wt, "a.txt", "crew\n");
    writeFileSync(join(main, "b.txt"), "wip\n");
    const parked = await createLocalGit().merge(wt, "bb/x", "main", "Merge bb/x");
    git(main, "checkout", "--", "b.txt");
    const outcome = await createLocalGit().release(wt, "main");
    expect(outcome).toEqual({ kind: "released", commit: parked.ok ? parked.commit : "" });
    expect(git(main, "rev-parse", "main")).toBe(parked.ok ? parked.commit : "");
    expect(git(main, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(main, "a.txt"), "utf8")).toBe("crew\n");
    expect(() => git(main, "rev-parse", "--verify", "--quiet", "refs/crew/integration/main")).toThrow();
  });

  it("negative: release while the checkout is still dirty moves nothing and keeps the ref (BBP-271)", async () => {
    const { main, wt } = repo();
    commit(wt, "a.txt", "crew\n");
    writeFileSync(join(main, "b.txt"), "wip\n");
    const parked = await createLocalGit().merge(wt, "bb/x", "main", "Merge bb/x");
    const before = git(main, "rev-parse", "main");
    expect(await createLocalGit().release(wt, "main")).toEqual({ kind: "held" });
    expect(git(main, "rev-parse", "main")).toBe(before);
    expect(git(main, "rev-parse", "refs/crew/integration/main")).toBe(parked.ok ? parked.commit : "");
    expect(readFileSync(join(main, "b.txt"), "utf8")).toBe("wip\n");
    expect(git(main, "stash", "list")).toBe("");
  });

  it("release without a checkout of main moves main by update-ref; without a parked ref there is nothing to release (BBP-271)", async () => {
    const { main, wt } = repo();
    expect(await createLocalGit().release(wt, "main")).toEqual({ kind: "none" });
    commit(wt, "a.txt", "crew\n");
    writeFileSync(join(main, "b.txt"), "wip\n");
    const parked = await createLocalGit().merge(wt, "bb/x", "main", "Merge bb/x");
    git(main, "checkout", "--", "b.txt");
    git(main, "switch", "-q", "--detach");
    expect(await createLocalGit().release(wt, "main")).toEqual({ kind: "released", commit: parked.ok ? parked.commit : "" });
    expect(git(main, "rev-parse", "main")).toBe(parked.ok ? parked.commit : "");
  });
});
