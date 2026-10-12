import { describe, expect, it } from "vitest";
import { planMotion, MOTION_ENTER, MOTION_EXIT, MOTION_MOVE } from "../lib/tree-motion";

type N = { id: string; position: { x: number; y: number }; className?: string; data: Record<string, unknown> };
const n = (id: string, y = 0): N => ({ id, position: { x: 0, y }, data: {} });

describe("planMotion", () => {
  it("animates nothing on the first render — the whole tree is not 'new'", () => {
    const plan = planMotion(null, [n("a"), n("b")], false);
    expect(plan.nodes.map((node) => node.className)).toEqual([undefined, undefined]);
    expect(plan.exiting).toEqual([]);
  });

  it("fades a new node in, glides a kept one and fades a removed one out", () => {
    const plan = planMotion([n("a"), n("gone", 10)], [n("a", 5), n("new", 20)], false);
    const byId = new Map(plan.nodes.map((node) => [node.id, node]));
    expect(byId.get("new")!.className).toContain(MOTION_ENTER);
    expect(byId.get("a")!.className).toContain(MOTION_MOVE);
    expect(byId.get("a")!.className).not.toContain(MOTION_ENTER);
    expect(plan.exiting.map((node) => node.id)).toEqual(["gone"]);
    expect(plan.exiting[0]!.className).toContain(MOTION_EXIT);
    // The ghost stays where it was, not where a new layout would put it.
    expect(plan.exiting[0]!.position).toEqual({ x: 0, y: 10 });
  });

  it("keeps a node's own className next to the motion class", () => {
    const plan = planMotion([n("a")], [{ ...n("a"), className: "own" }], false);
    expect(plan.nodes[0]!.className).toBe(`own ${MOTION_MOVE}`);
  });

  it("with reduced motion: same end state, no animation classes, no ghosts", () => {
    const plan = planMotion([n("a"), n("gone")], [n("a", 5), n("new")], true);
    expect(plan.nodes.map((node) => node.id)).toEqual(["a", "new"]);
    expect(plan.nodes.every((node) => node.className === undefined)).toBe(true);
    expect(plan.exiting).toEqual([]);
  });

  it("a poll without changes enters and exits nothing", () => {
    const plan = planMotion([n("a"), n("b")], [n("a"), n("b")], false);
    expect(plan.nodes.some((node) => node.className?.includes(MOTION_ENTER))).toBe(false);
    expect(plan.exiting).toEqual([]);
  });
});
