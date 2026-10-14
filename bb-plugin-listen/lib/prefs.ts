/**
 * The choices the Listen page makes, kept apart from BB's generic settings
 * form.
 *
 * Why not `bb.settings`: that form has no way to hide a field, so every value
 * the page already edits with a dropdown showed up a second time as a text
 * box. What stays in the generic form is what only makes sense there — a
 * secret, a prompt, a number.
 */

import { z } from "zod";

const voiceSchema = z.object({ id: z.string(), sid: z.number() });

export const prefsSchema = z.object({
  /** BCP-47 base tag. Also the language the microphone listens for. */
  primaryLanguage: z.string(),
  /** Empty means there is no second language. */
  secondaryLanguage: z.string(),
  /** Recognition model id. */
  model: z.string(),
  primaryVoice: voiceSchema,
  secondaryVoice: voiceSchema,
  summarize: z.boolean(),
  summaryBackend: z.enum(["thread", "api"]),
  summaryThreadProvider: z.string(),
  summaryThreadModel: z.string(),
  summaryApiModel: z.string(),
  summaryApiUrl: z.string(),
});
export type Prefs = z.infer<typeof prefsSchema>;

export const DEFAULT_PREFS: Prefs = {
  primaryLanguage: "uk",
  secondaryLanguage: "en",
  model: "parakeet-v3",
  primaryVoice: { id: "piper-uk_UA-ukrainian_tts-medium-int8", sid: 0 },
  secondaryVoice: { id: "kitten-nano-en-v0_2", sid: 0 },
  summarize: true,
  summaryBackend: "thread",
  summaryThreadProvider: "",
  summaryThreadModel: "",
  summaryApiModel: "gemma3:4b",
  summaryApiUrl: "http://127.0.0.1:11434/v1",
};

/**
 * Whatever storage held, as a complete `Prefs`. Missing or malformed fields
 * fall back one by one, so a value from an older version cannot lose the
 * rest of the user's choices.
 */
export function normalizePrefs(raw: unknown): Prefs {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const result: Record<string, unknown> = { ...DEFAULT_PREFS };
  for (const key of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) {
    const field = prefsSchema.shape[key].safeParse(source[key]);
    if (field.success) result[key] = field.data;
  }
  return result as Prefs;
}

export type Script = "cyrillic" | "latin";

/** Languages written in Cyrillic; everything else is treated as Latin. */
const CYRILLIC_LANGUAGES = new Set(["uk", "ru", "bg", "be", "sr", "mk"]);

export function scriptOf(language: string): Script {
  return CYRILLIC_LANGUAGES.has(language.split(/[-_]/)[0]!.toLowerCase())
    ? "cyrillic"
    : "latin";
}

/**
 * The dominant script of a text, ignoring digits, punctuation and anything
 * that is code rather than prose. Null when there are no letters at all.
 *
 * Code is cut first because identifiers are Latin whatever the language: a
 * single `settings.onChange` outweighs a short Ukrainian sentence.
 */
export function detectScript(text: string): Script | null {
  const prose = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  const cyrillic = prose.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  const latin = prose.match(/\p{Script=Latin}/gu)?.length ?? 0;
  if (cyrillic + latin === 0) return null;
  return cyrillic >= latin ? "cyrillic" : "latin";
}

export type VoiceChoice = {
  slot: "primary" | "secondary";
  voice: { id: string; sid: number };
  language: string;
};

/**
 * The voice that matches a text.
 *
 * Only the script is detected, so Ukrainian against English is told apart
 * while Ukrainian against Russian — or English against German — is not. When
 * both languages share a script the primary one wins, which is the honest
 * answer to a question this method cannot decide.
 */
export function chooseVoice(prefs: Prefs, text: string): VoiceChoice {
  const primary: VoiceChoice = {
    slot: "primary",
    voice: prefs.primaryVoice,
    language: prefs.primaryLanguage,
  };
  const secondary: VoiceChoice | null =
    prefs.secondaryLanguage === ""
      ? null
      : { slot: "secondary", voice: prefs.secondaryVoice, language: prefs.secondaryLanguage };

  const script = detectScript(text);
  if (script === null || secondary === null) return primary;
  if (scriptOf(primary.language) === script) return primary;
  if (scriptOf(secondary.language) === script) return secondary;
  return primary;
}

/**
 * Whether a summary is written in the script of the answer it condenses.
 * A summary that switched script — a Ukrainian answer boiled down to English —
 * would be read by the wrong voice, so the caller drops it. Unknown counts as
 * matching: with no letters on either side there is nothing to contradict.
 */
export function sameScript(answer: string, summary: string): boolean {
  const wanted = detectScript(answer);
  const got = detectScript(summary);
  return wanted === null || got === null || wanted === got;
}
