import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PREVIEW_SAMPLES,
  previewLanguage,
  previewText,
  type PreviewVoiceModel,
} from "./preview-text.js";

const german: PreviewVoiceModel = {
  languages: ["de-DE"],
  voices: [{ sid: 0, name: "Piper Thorsten (de-DE)" }],
};

const kokoro: PreviewVoiceModel = {
  languages: ["en", "zh", "ja", "ko", "es", "fr", "hi", "it", "pt"],
  voices: [
    { sid: 0, name: "af_heart (en-US, female)" },
    { sid: 33, name: "ff_siwis (fr, female)" },
    { sid: 48, name: "zf_xiaobei (zh, female)" },
    { sid: 99, name: "mystery voice" },
  ],
};

describe("previewLanguage", () => {
  it("takes the language of a single-language model", () => {
    expect(previewLanguage(german, 0)).toBe("de");
  });

  it("does not fall back to English for a non-English model", () => {
    expect(previewLanguage(german, 0)).not.toBe("en");
  });

  it("reads the language out of the voice label of a multilingual model", () => {
    expect(previewLanguage(kokoro, 33)).toBe("fr");
    expect(previewLanguage(kokoro, 48)).toBe("zh");
    expect(previewLanguage(kokoro, 0)).toBe("en");
  });

  it("falls back to English when a multilingual voice names no language", () => {
    expect(previewLanguage(kokoro, 99)).toBe("en");
  });

  it("falls back to English for an unknown model or an unknown tag", () => {
    expect(previewLanguage(null, 0)).toBe("en");
    expect(previewLanguage({ languages: ["xx-YY"], voices: [] }, 0)).toBe("en");
  });
});

describe("previewText", () => {
  it("speaks German to a German voice", () => {
    expect(previewText(german, 0)).toBe(PREVIEW_SAMPLES.de);
  });

  it("never hands a non-English voice the English sample", () => {
    expect(previewText(german, 0)).not.toBe(PREVIEW_SAMPLES.en);
    expect(previewText(kokoro, 33)).not.toBe(PREVIEW_SAMPLES.en);
  });

  it("speaks English when nothing better is known", () => {
    expect(previewText(null, null)).toBe(PREVIEW_SAMPLES.en);
  });

  it("has a sample for every language the catalog offers", () => {
    for (const tag of ["en", "de", "fr", "es", "it", "pt", "nl", "ru", "tr", "ar", "zh", "ja", "ko", "hi"]) {
      expect(PREVIEW_SAMPLES[tag], tag).toBeTruthy();
    }
  });
});

describe("every language in the voice catalog has a sample", () => {
  // A language without one is previewed with the English sentence, which a
  // non-English voice reads as nonsense.
  it("covers Ukrainian, and the voice previews in Ukrainian", () => {
    const model = { languages: ["uk-UA"], voices: [{ sid: 0, name: "Speaker 0" }] };
    expect(previewLanguage(model, 0)).toBe("uk");
    expect(previewText(model, 0)).toMatch(/[іїєґ]/i);
  });

  it("covers every language the catalog lists", () => {
    const source = readFileSync(join(__dirname, "../../host/tts-catalog.ts"), "utf8");
    // Every array of language tags, whether a `languages:` field or a piper() argument.
    const tags = [...source.matchAll(/\[((?:"[a-z]{2}(?:-[A-Z]{2})?",?\s*)+)\]/g)].flatMap(
      (match) => [...match[1]!.matchAll(/"([a-z]{2})/g)].map((tag) => tag[1]!),
    );
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of new Set(tags)) expect(PREVIEW_SAMPLES).toHaveProperty(tag);
  });
});
