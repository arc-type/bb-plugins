/**
 * The instruction that keeps a summary in the language of the answer.
 *
 * Added in code rather than only in the default prompt, because the prompt is
 * a setting: someone who rewrote it for tone would otherwise lose the rule
 * without noticing, and get English summaries of Ukrainian threads.
 */
export const LANGUAGE_RULE =
  "Write the summary in the same language as the message below. Never translate it.";

export function withLanguageRule(prompt: string): string {
  return `${LANGUAGE_RULE}\n\n${prompt}`;
}
