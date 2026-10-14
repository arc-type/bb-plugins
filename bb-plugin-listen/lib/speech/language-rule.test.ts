import { describe, expect, it } from "vitest";
import { LANGUAGE_RULE, withLanguageRule } from "./language-rule";
import { sameScript } from "../prefs";

describe("withLanguageRule", () => {
  it("puts the rule ahead of a custom prompt and keeps the prompt intact", () => {
    const result = withLanguageRule("Be brief.\nMessage:");
    expect(result.startsWith(LANGUAGE_RULE)).toBe(true);
    expect(result.endsWith("Be brief.\nMessage:")).toBe(true);
  });
});

describe("sameScript", () => {
  it("accepts a summary in the answer's language", () => {
    expect(sameScript("Я виправив помилку у файлі", "Помилку виправлено.")).toBe(true);
    expect(sameScript("I fixed the bug in the file", "The bug is fixed.")).toBe(true);
  });
  it("rejects a summary that switched script", () => {
    expect(sameScript("Я виправив помилку у файлі", "The bug is fixed.")).toBe(false);
    expect(sameScript("I fixed the bug in the file", "Помилку виправлено.")).toBe(false);
  });
  it("has nothing to contradict without letters", () => {
    expect(sameScript("42", "The bug is fixed.")).toBe(true);
  });
});
