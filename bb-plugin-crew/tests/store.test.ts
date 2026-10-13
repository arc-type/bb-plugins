import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createStore, migrateInPlace } from "../lib/store";

describe("store member key", () => {
  it("reads the key from the stored address, not from group and member id", () => {
    const db = new Database(":memory:");
    migrateInPlace(db);
    const store = createStore(db);
    const { crew } = store.saveCrewFile("p1", "solo", "name: solo\n");
    const member = store.upsertMember(crew.id, { groupId: "steps", memberId: "lead", address: "lead@solo", lead: true, config: {} });
    store.bind(member.id, "thr_1", 1);

    expect(member.key).toBe("lead");
    expect(store.listMembers(crew.id).map((m) => m.key)).toEqual(["lead"]);
    expect(store.crewThreads(crew.id).map((t) => t.key)).toEqual(["lead"]);
  });
});
