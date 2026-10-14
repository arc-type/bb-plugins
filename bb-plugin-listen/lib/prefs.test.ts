import { describe, expect, it } from "vitest";
import { chooseVoice, DEFAULT_PREFS, detectScript, normalizePrefs } from "./prefs";

describe("detectScript", () => {
  it("tells Cyrillic from Latin by the majority of letters", () => {
    expect(detectScript("Привіт, світе")).toBe("cyrillic");
    expect(detectScript("Hello there")).toBe("latin");
  });
  it("lets the prose win over a few code words", () => {
    expect(detectScript("Я виправив `settings.onChange` у файлі")).toBe("cyrillic");
    expect(detectScript("Fixed the bug, дякую")).toBe("latin");
  });
  it("has no opinion without letters", () => {
    expect(detectScript("12 + 3 = 15 ...")).toBeNull();
  });
});

describe("chooseVoice", () => {
  const prefs = {
    ...DEFAULT_PREFS,
    primaryVoice: { id: "uk-voice", sid: 1 },
    secondaryVoice: { id: "en-voice", sid: 2 },
  };
  it("speaks Ukrainian with the primary voice", () => {
    expect(chooseVoice(prefs, "Готово, все працює.")).toMatchObject({
      slot: "primary",
      voice: { id: "uk-voice", sid: 1 },
      language: "uk",
    });
  });
  it("speaks English with the secondary voice", () => {
    expect(chooseVoice(prefs, "Done, everything works.")).toMatchObject({
      slot: "secondary",
      voice: { id: "en-voice", sid: 2 },
      language: "en",
    });
  });
  it("uses the primary voice when there is no second language", () => {
    expect(chooseVoice({ ...prefs, secondaryLanguage: "" }, "Done.").slot).toBe("primary");
  });
  it("uses the primary voice for text without letters", () => {
    expect(chooseVoice(prefs, "42").slot).toBe("primary");
  });
  it("cannot split two languages in one script, so the primary one wins", () => {
    const pair = { ...prefs, primaryLanguage: "en", secondaryLanguage: "de" };
    expect(chooseVoice(pair, "Das funktioniert jetzt").slot).toBe("primary");
  });
  it("falls back to primary when neither language uses the text's script", () => {
    const pair = { ...prefs, primaryLanguage: "en", secondaryLanguage: "de" };
    expect(chooseVoice(pair, "Привіт").slot).toBe("primary");
  });
});

describe("normalizePrefs", () => {
  it("returns the defaults for nothing stored", () => {
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_PREFS);
  });
  it("keeps valid fields and replaces only the broken ones", () => {
    const result = normalizePrefs({ primaryLanguage: "de", model: 5, primaryVoice: { id: "x" } });
    expect(result.primaryLanguage).toBe("de");
    expect(result.model).toBe(DEFAULT_PREFS.model);
    expect(result.primaryVoice).toEqual(DEFAULT_PREFS.primaryVoice);
  });
});
