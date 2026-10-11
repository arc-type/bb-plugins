// Turns raw Markdown excerpts into readable one-paragraph text for result rows.

const MAX_SNIPPET = 240;

/** Frontmatter keys that vault notes put at the top; they say nothing about the hit. */
const FRONTMATTER_LINE =
  /^\s*(---|(type|status|tags|updated|created|date|aliases|alias|title|source|sources|author|draft|review|cssclasses)\s*:.*)$/gim;

export function plainSnippet(markdown: string): string {
  const text = markdown
    .replace(FRONTMATTER_LINE, "")
    // [[target|label]] and [[target]] wiki links keep their visible text.
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, (_, target: string) => target.split("/").pop() ?? target)
    // ![alt](src) images drop out, [label](url) links keep the label.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Bare URLs and URLs cut off mid-way say nothing in a one-line excerpt.
    .replace(/\(?https?:\/\/\S*/g, "")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    // Markers left open where qmd or BB cut the excerpt.
    .replace(/\*\*|__|~~|`+|\[\[|\]\]/g, "")
    // Table rows: pipes and separator rows become plain gaps.
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/\s+/g, " ")
    .replace(/(^[\s·]+|[\s·]+$)/g, "")
    .trim();
  return text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET).trimEnd()}…` : text;
}
