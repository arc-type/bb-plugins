import { describe, expect, it } from "vitest";
import { running, setup, trioYaml } from "./helpers";

// BBP-263: members have no parent thread (ADR 0003), so a crew is grouped in
// BB's sidebar by a thread section named after the crew.
async function trio() {
  const env = setup();
  const crew = await running(env.service, env.port);
  const sectionOf = (threadId: string) => env.port.threads.get(threadId)!.sectionId;
  const sectionNamed = (name: string) => [...env.port.sections].filter(([, value]) => value === name).map(([id]) => id);
  return { ...env, ...crew, sectionOf, sectionNamed };
}

describe("crew section", () => {
  it("apply creates a section named after the crew and files the lead and every member into it", async () => {
    const t = await trio();
    const [section] = t.sectionNamed("trio");
    expect(section).toBeDefined();
    for (const threadId of Object.values(t.threads)) expect(t.sectionOf(threadId)).toBe(section);
  });

  it("negative: an existing section with the crew's name is reused, never duplicated, also on a second apply", async () => {
    const env = setup();
    env.port.sections.set("sec_hand", "trio");
    const crew = await running(env.service, env.port);
    await env.service.apply("proj_1", env.store.crewFile(crew.crew.id)!.yaml);
    expect([...env.port.sections.values()].filter((name) => name === "trio")).toHaveLength(1);
    for (const threadId of Object.values(crew.threads)) expect(env.port.threads.get(threadId)!.sectionId).toBe("sec_hand");
  });

  it("apply files existing threads that are in no section yet (self-healing)", async () => {
    const t = await trio();
    const lead = t.port.threads.get(t.threads["orch-lead"]!)!;
    lead.sectionId = null;
    await t.service.apply("proj_1", t.store.crewFile(t.crew.id)!.yaml);
    expect(lead.sectionId).toBe(t.sectionNamed("trio")[0]);
  });

  it("a new shift (reset --mode new) files the new thread into the section", async () => {
    const t = await trio();
    const result = await t.service.lifecycle.reset(t.crew, "dev-impl", "new");
    expect(result.threadId).not.toBe(t.threads["dev-impl"]);
    expect(t.sectionOf(result.threadId!)).toBe(t.sectionNamed("trio")[0]);
  });

  it("add member files the new thread into the section", async () => {
    const t = await trio();
    const outcome = await t.service.lifecycle.addMember(t.crew, { group: "dev", id: "docs", role: "Writes docs." });
    const added = outcome.results.find((r) => r.key === "dev-docs")!;
    expect(t.sectionOf(added.threadId!)).toBe(t.sectionNamed("trio")[0]);
  });

  it("negative: a failing section call does not fail apply", async () => {
    const env = setup();
    env.port.sectionFailures.push(new Error("sections down"));
    const outcome = await env.service.apply("proj_1", trioYaml());
    expect(outcome.results.every((r) => r.result === "spawned")).toBe(true);
  });

  it("delete removes the crew's section; the threads stay (archive mode)", async () => {
    const t = await trio();
    await t.service.stop(t.store.getCrew(t.crew.id)!);
    await t.service.delete(t.store.getCrew(t.crew.id)!);
    expect(t.sectionNamed("trio")).toEqual([]);
    for (const threadId of Object.values(t.threads)) {
      expect(t.port.threads.get(threadId)).toBeDefined();
      expect(t.sectionOf(threadId)).toBeNull();
    }
  });
});
