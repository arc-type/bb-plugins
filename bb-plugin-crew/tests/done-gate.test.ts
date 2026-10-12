// BBP-176: `gates.done` blocks `crew_work_done` on a red command. The seam is
// `queue.done` driven through the service, with `GitBackend.checks` faked
// (integration.ts's `createFakeGit`) so no real command ever runs.
import { describe, expect, it } from "vitest";
import { AddressError } from "../lib/delivery";
import { PROJECT, running, setup, trioYaml } from "./helpers";

const human = { kind: "human" as const };

/** trio with `dev-impl` gated on the given commands; apply confirms the gate. */
async function gatedCrew(commands: string[]) {
  const env = setup();
  const crew = await running(
    env.service,
    env.port,
    trioYaml({ groups: [{ id: "orch", members: [{ id: "lead", lead: true, role: "Plans." }] }, { id: "dev", members: [{ id: "impl", role: "Builds.", gates: { done: commands } }, { id: "review", permissions: "ask", role: "Reviews." }] }] }),
    "idle",
    { confirmGates: true },
  );
  const member = (key: string) => ({ kind: "member" as const, member: crew.members[key]! });
  return { ...env, ...crew, member };
}

describe("done gate (gates.done)", () => {
  it("green: every command runs in order, the item closes, and the done note carries the gate summary", async () => {
    const { service, store, crew, member, git } = await gatedCrew(["npm test", "npm run lint"]);
    const item = service.queue.create(crew, human, { title: "x", owner: "dev-impl" });
    service.queue.claim(crew, member("dev-impl"), item.id);
    const done = await service.queue.done(crew, member("dev-impl"), item.id, "shipped");
    expect(done.state).toBe("done");
    expect(done.closureNote).toBe("shipped");
    expect(git.calls.filter((c) => c.method === "checks").map((c) => c.args[1])).toEqual(["npm test", "npm run lint"]);
    const last = store.listTransitions(item.id).at(-1)!;
    expect(last).toMatchObject({ fromState: "claimed", toState: "done" });
    expect(last.note).toContain("Gate green: npm test, npm run lint");
  });

  it("red: the first failing command blocks, the item stays claimed, state_since is unchanged, and the member sees command/exit/output", async () => {
    const { service, store, crew, member, git, advance } = await gatedCrew(["npm test", "npm run lint"]);
    const item = service.queue.create(crew, human, { title: "x", owner: "dev-impl" });
    service.queue.claim(crew, member("dev-impl"), item.id);
    const before = store.getWork(item.id)!;
    advance(5000);
    git.checksResult = { kind: "failed", code: 1, output: "1 failing test" };
    await expect(service.queue.done(crew, member("dev-impl"), item.id, "done?")).rejects.toThrow(/npm test.*exit 1/s);
    const after = store.getWork(item.id)!;
    expect(after.state).toBe("claimed");
    expect(after.stateSince).toBe(before.stateSince);
    expect(after.closureNote).toBeNull();
    // Abort at the first red command: lint never runs.
    expect(git.calls.filter((c) => c.method === "checks").map((c) => c.args[1])).toEqual(["npm test"]);
    const last = store.listTransitions(item.id).at(-1)!;
    expect(last).toMatchObject({ fromState: "claimed", toState: "claimed" });
    expect(last.note).toContain("npm test");
    expect(last.note).toContain("exit 1");
    expect(last.note).toContain("1 failing test");
  });

  it("126/127 (command could not run) counts as red too", async () => {
    const { service, crew, member, git } = await gatedCrew(["missing-cmd"]);
    const item = service.queue.create(crew, human, { title: "x", owner: "dev-impl" });
    service.queue.claim(crew, member("dev-impl"), item.id);
    git.checksResult = { kind: "env", code: 127, output: "command not found" };
    await expect(service.queue.done(crew, member("dev-impl"), item.id, "")).rejects.toThrow(/exit 127/);
  });

  it("remote host: done is refused with a reason, no transition is logged", async () => {
    const env = setup();
    env.port.projectHost = "host_remote";
    const crewResult = await running(
      env.service,
      env.port,
      trioYaml({ groups: [{ id: "orch", members: [{ id: "lead", lead: true, role: "Plans." }] }, { id: "dev", members: [{ id: "impl", role: "Builds.", gates: { done: ["npm test"] } }, { id: "review", permissions: "ask", role: "Reviews." }] }] }),
      "idle",
      { confirmGates: true },
    );
    const { crew, members } = crewResult;
    const member = (key: string) => ({ kind: "member" as const, member: members[key]! });
    const item = env.service.queue.create(crew, human, { title: "x", owner: "dev-impl" });
    env.service.queue.claim(crew, member("dev-impl"), item.id);
    const before = env.store.listTransitions(item.id).length;
    await expect(env.service.queue.done(crew, member("dev-impl"), item.id, "")).rejects.toThrow(AddressError);
    expect(env.store.getWork(item.id)!.state).toBe("claimed");
    expect(env.store.listTransitions(item.id).length).toBe(before);
  });

  it("missing worktree: done is refused, no transition is logged", async () => {
    const { service, store, crew, members, member, port, threads } = await gatedCrew(["npm test"]);
    const item = service.queue.create(crew, human, { title: "x", owner: "dev-impl" });
    service.queue.claim(crew, member("dev-impl"), item.id);
    port.threads.get(threads["dev-impl"]!)!.environmentId = null;
    store.setMemberEnv(members["dev-impl"]!.id, { environmentId: null, path: null, branch: null });
    const before = store.listTransitions(item.id).length;
    await expect(service.queue.done(crew, member("dev-impl"), item.id, "")).rejects.toThrow(/worktree is unknown/);
    expect(store.getWork(item.id)!.state).toBe("claimed");
    expect(store.listTransitions(item.id).length).toBe(before);
  });

  it("no gate: unchanged behaviour, checks never runs", async () => {
    const env = setup();
    const { crew, members } = await running(env.service, env.port, trioYaml());
    const member = (key: string) => ({ kind: "member" as const, member: members[key]! });
    const item = env.service.queue.create(crew, human, { title: "x", owner: "dev-impl" });
    env.service.queue.claim(crew, member("dev-impl"), item.id);
    const done = await env.service.queue.done(crew, member("dev-impl"), item.id, "done");
    expect(done.state).toBe("done");
    expect(env.git.count("checks")).toBe(0);
  });

  it("the human via the CLI overrides the gate: done closes even on a red command", async () => {
    const { service, crew, git } = await gatedCrew(["npm test"]);
    const item = service.queue.create(crew, human, { title: "x", owner: "dev-impl" });
    git.checksResult = { kind: "failed", code: 1, output: "1 failing test" };
    const done = await service.queue.done(crew, human, item.id, "override");
    expect(done.state).toBe("done");
    expect(git.count("checks")).toBe(0);
  });
});
