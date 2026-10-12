// BBP-179 acceptance in BB: the canvas in a slim panel (370–700px, BB with
// the file tree open) — the project dropdown must stay inside the canvas,
// and Collapse all / Expand all must leave the tree in view, not blank.
import { test, expect, type Page } from "@playwright/test";

const inside = async (page: Page, selector: string) => {
  const view = (await page.locator("[data-canvas-view]").boundingBox())!;
  const box = (await page.locator(selector).first().boundingBox())!;
  return box.x >= view.x - 0.5 && box.x + box.width <= view.x + view.width + 0.5;
};

const inViewport = async (page: Page, name: RegExp) => {
  const pane = (await page.locator(".react-flow").boundingBox())!;
  const card = (await page.getByRole("button", { name }).boundingBox())!;
  return (
    card.x >= pane.x && card.x + card.width <= pane.x + pane.width && card.y >= pane.y && card.y + card.height <= pane.y + pane.height
  );
};

for (const width of [370, 500, 700]) {
  test(`at ${width}px the project dropdown opens inside the canvas`, async ({ page }) => {
    await page.goto(`/index.html?width=${width}`);
    await page.getByRole("button", { name: /^Projects:/ }).click();
    await expect(page.getByRole("group", { name: "Projects" })).toBeVisible();
    expect(await inside(page, '[role="group"][aria-label="Projects"]')).toBe(true);
    expect(await inside(page, 'button:has-text("Expand all")')).toBe(true);
  });
}

test("at full width the dropdown still opens inside the canvas", async ({ page }) => {
  await page.goto("/index.html");
  await page.getByRole("button", { name: /^Projects:/ }).click();
  expect(await inside(page, '[role="group"][aria-label="Projects"]')).toBe(true);
});

test("Collapse all re-fits the view: the root is on screen", async ({ page }) => {
  await page.goto("/index.html?width=500");
  await page.getByRole("button", { name: "Expand all" }).click();
  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect.poll(() => inViewport(page, /^Agents — /)).toBe(true);
});

test("Expand all re-fits the view: the deepest card is on screen", async ({ page }) => {
  await page.goto("/index.html?width=500");
  await page.getByRole("button", { name: "Collapse all" }).click();
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect.poll(() => inViewport(page, /^review — /)).toBe(true);
  await expect.poll(() => inViewport(page, /^Agents — /)).toBe(true);
});
