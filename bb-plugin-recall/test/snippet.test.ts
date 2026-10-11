import { describe, expect, it } from "vitest";
import { plainSnippet } from "../lib/snippet.js";

describe("plainSnippet", () => {
  it("keeps link labels and drops URLs and local paths", () => {
    expect(plainSnippet("…· [Product-Stock-DM2](/Users/me/brain/07%20Product.md) ·…")).toBe("…· Product-Stock-DM2 ·…");
  });

  it("resolves wiki links to their label or file name", () => {
    expect(plainSnippet("see [[06 Product-Prices-DM2\\|06 Product Prices DM2]] and [[a/b/Cart Grouping]]")).toContain(
      "and Cart Grouping",
    );
    expect(plainSnippet("[[x|Label]]")).toBe("Label");
  });

  it("strips emphasis, code, headings and table pipes", () => {
    expect(plainSnippet("## Title\n**DM2** — `product-final` | col | col2 |\n|---|---|")).toBe(
      "Title DM2 — product-final · col · col2",
    );
  });

  it("drops vault frontmatter but keeps ordinary key-value prose", () => {
    expect(plainSnippet("type: project\nstatus: aktiv\ntags: [a, b]\nThe real text")).toBe("The real text");
    expect(plainSnippet("Note: keep this")).toBe("Note: keep this");
  });

  it("removes markers left open by a cut excerpt", () => {
    expect(plainSnippet("Store. * **Elasticsearch…")).toBe("Store. * Elasticsearch…");
    expect(plainSnippet("and `[[04…")).toBe("and 04…");
  });

  it("drops bare and truncated URLs", () => {
    expect(plainSnippet("Epic [&56 Navision Decoupling] (https://gitlab.example.net/groups/web…")).toBe(
      "Epic [&56 Navision Decoupling]",
    );
    expect(plainSnippet("see https://example.com/a for details")).toBe("see for details");
  });

  it("leaves plain text alone and caps very long text", () => {
    expect(plainSnippet("plain words")).toBe("plain words");
    expect(plainSnippet("a ".repeat(400)).endsWith("…")).toBe(true);
  });
});
