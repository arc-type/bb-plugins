// BBP-173/WI7: jsdom never lays anything out, so a container with no
// explicit height collapsing the canvas to 0px cannot be caught by the
// vitest suite — only a real browser measurement catches it.
import { test, expect } from "@playwright/test";

test("the canvas keeps a usable height even inside a container with no explicit height", async ({ page }) => {
  await page.goto("/height.html");
  const canvas = page.locator("[data-canvas-view]");
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThan(100);
});
