// BBP-182/186: the sidebar's resize separator in a real browser — real
// pointer drag and real key presses, each gated on the rendered width.
import { test, expect, type Page } from "@playwright/test";

const sidebar = (page: Page) => page.getByLabel("Details for orch-lead");
const handle = (page: Page) => page.getByRole("separator", { name: "Resize details" });
const renderedWidth = async (page: Page) => (await sidebar(page).boundingBox())!.width;

async function openSidebar(page: Page) {
  await page.getByRole("button", { name: new RegExp("^orch-lead — ") }).click();
  await expect(sidebar(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await page.evaluate(() => localStorage.removeItem("bb-canvas:sidebar-width"));
  await page.reload();
  await page.getByRole("button", { name: new RegExp("^factory-1 — ") }).waitFor();
  await openSidebar(page);
});

test("starts at the default width of 320px", async ({ page }) => {
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "320");
  expect(await renderedWidth(page)).toBe(320);
});

test("Left/Right move 16px, Home/End jump to the bounds and stay there", async ({ page }) => {
  await handle(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "336");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "304");

  await page.keyboard.press("End");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "640");
  expect(await renderedWidth(page)).toBe(640);

  await page.keyboard.press("Home");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "240");
  expect(await renderedWidth(page)).toBe(240);
});

test("dragging resizes live and clamps past either edge", async ({ page }) => {
  const box = (await handle(page).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 50, y, { steps: 5 });
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "370");
  await page.mouse.move(x - 2000, y, { steps: 5 });
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "640");
  await page.mouse.move(x + 2000, y, { steps: 5 });
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "240");
  await page.mouse.up();
  expect(await renderedWidth(page)).toBe(240);
});

test("the chosen width survives a reload", async ({ page }) => {
  await handle(page).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "352");
  await page.reload();
  await page.getByRole("button", { name: new RegExp("^factory-1 — ") }).waitFor();
  await openSidebar(page);
  await expect(handle(page)).toHaveAttribute("aria-valuenow", "352");
  expect(await renderedWidth(page)).toBe(352);
});
