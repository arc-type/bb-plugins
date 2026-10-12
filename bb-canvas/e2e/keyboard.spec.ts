// BBP-131 acceptance criterion 12: keyboard navigation against a real
// browser, each key a gate on an observable state change — not a smoke test.
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await page.getByRole("button", { name: new RegExp("^factory-1 — ") }).waitFor();
  // Keys land on whatever has focus; nothing does until something is
  // clicked, so every test starts by focusing the view itself.
  await page.locator("[data-canvas-view]").focus();
});

test("arrow keys move the selection between siblings", async ({ page }) => {
  await page.getByRole("button", { name: new RegExp("^orch-lead — ") }).click();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: new RegExp("^steps-impl — ") })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("button", { name: new RegExp("^orch-lead — ") })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Enter expands a collapsed card", async ({ page }) => {
  await page.getByRole("button", { name: new RegExp("^orch-lead — ") }).click();
  await expect(page.getByRole("button", { name: /^review-flow #12 — / })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^review-flow #12 — / })).toBeVisible();
});

test("J jumps to the running card", async ({ page }) => {
  await page.keyboard.press("j");
  await expect(page.getByRole("button", { name: new RegExp("^orch-lead — ") })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("0 resets zoom and pan without error", async ({ page }) => {
  await page.keyboard.press("0");
  await expect(page.getByRole("button", { name: new RegExp("^factory-1 — ") })).toBeVisible();
});

test("/ opens search and jumps to the first match on Enter", async ({ page }) => {
  await page.keyboard.press("/");
  const search = page.getByRole("textbox", { name: "Search nodes" });
  await expect(search).toBeFocused();
  await search.fill("steps-review");
  await search.press("Enter");
  await expect(page.getByRole("button", { name: new RegExp("^steps-review — ") })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Escape closes the sidebar", async ({ page }) => {
  await page.getByRole("button", { name: new RegExp("^orch-lead — ") }).click();
  await expect(page.getByLabel("Details for orch-lead")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Details for orch-lead")).toHaveCount(0);
});

test("a back edge in a run draws as an arc, not a straight line", async ({ page }) => {
  await page.getByRole("button", { name: new RegExp("^orch-lead — ") }).click();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /^review-flow #12 — / }).click();
  await page.keyboard.press("Enter");
  const backEdge = page
    .locator('[data-testid="rf__edge-step:r1:review->step:r1:plan-9"] path.react-flow__edge-path')
    .first();
  await expect(backEdge).toBeVisible();
  // A straight connector would need only two points; the arc's control
  // points bow it out well past either step's x position.
  const d = await backEdge.getAttribute("d");
  const xs = [...d!.matchAll(/(-?[\d.]+)[ ,]/g)].map((m) => Number(m[1]));
  const endpoints = [xs[0]!, xs.at(-1)!];
  expect(Math.max(...xs)).toBeGreaterThan(Math.max(...endpoints) + 20);
});

test("screenshot: the canvas with a crew, a running run and its steps", async ({ page }) => {
  await page.getByRole("button", { name: new RegExp("^orch-lead — ") }).click();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /^review-flow #12 — / }).click();
  await page.keyboard.press("Enter");
  await page.keyboard.press("0");
  await page.screenshot({ path: "e2e/dist/canvas.png" });
});

// BBP-183: the chevron and the toggle keys, in a real browser.
test("a chevron click opens a card and shows the count while collapsed", async ({ page }) => {
  const chevron = page.getByRole("button", { name: /^Expand orch-lead \(1 child\)$/ });
  await expect(chevron).toBeVisible();
  await chevron.click();
  await expect(page.getByRole("button", { name: /^review-flow #12 — / })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Collapse orch-lead$/ })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: /^Collapse orch-lead$/ }).click();
  await expect(page.getByRole("button", { name: /^review-flow #12 — / })).toHaveCount(0);
});

test("Enter toggles, ArrowLeft collapses and then goes to the parent", async ({ page }) => {
  await page.getByRole("button", { name: new RegExp("^orch-lead — ") }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^review-flow #12 — / })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^review-flow #12 — / })).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: /^review-flow #12 — / })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: /^review-flow #12 — / })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: new RegExp("^orch-lead — ") })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: /^review-flow #12 — / })).toHaveCount(0);
});

test("negative: a leaf has no chevron and Enter does not open it", async ({ page }) => {
  await expect(page.getByRole("button", { name: /^(Expand|Collapse) steps-impl\b/ })).toHaveCount(0);
  const leaf = page.getByRole("button", { name: new RegExp("^steps-impl — ") });
  await leaf.click();
  const before = await page.getByRole("button", { name: / — / }).count();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await expect(leaf).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: / — / })).toHaveCount(before);
});

test("Expand all and Collapse all act on the whole tree", async ({ page }) => {
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.getByRole("button", { name: new RegExp("^plan — ") })).toBeVisible();
  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(page.getByRole("button", { name: new RegExp("^Agents — ") })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp("^bb-plugins — ") })).toHaveCount(0);
});
