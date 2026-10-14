import { describe, expect, it } from "vitest";
import { pickModel, type ModelEntry } from "./pick-model";

const entry = (model: string, isDefault = false): ModelEntry => ({ id: model, model, isDefault });

describe("pickModel", () => {
  it("prefers a small model over the provider's default", async () => {
    const picked = await pickModel([{ id: "claude", available: true }], async () => [
      entry("big-opus", true),
      entry("small-haiku"),
    ]);
    expect(picked).toEqual({ providerId: "claude", model: "small-haiku" });
  });

  it("takes the default when no model looks small", async () => {
    const picked = await pickModel([{ id: "p", available: true }], async () => [
      entry("alpha"),
      entry("beta", true),
    ]);
    expect(picked?.model).toBe("beta");
  });

  it("takes the first model when there is neither", async () => {
    const picked = await pickModel([{ id: "p", available: true }], async () => [entry("alpha")]);
    expect(picked?.model).toBe("alpha");
  });

  it("skips unavailable providers and ones whose catalogue fails", async () => {
    const picked = await pickModel(
      [
        { id: "off", available: false },
        { id: "broken", available: true },
        { id: "ok", available: true },
      ],
      async (id) => {
        if (id === "broken") throw new Error("boom");
        return [entry("m")];
      },
    );
    expect(picked).toEqual({ providerId: "ok", model: "m" });
  });

  it("returns null when nothing is installed", async () => {
    expect(await pickModel([{ id: "off", available: false }], async () => [entry("m")])).toBeNull();
    expect(await pickModel([{ id: "empty", available: true }], async () => [])).toBeNull();
  });
});
