// BBP-171 (BBP-163 WI7), acceptance criterion 10: add a member in the canvas
// edit mode, Apply, and the written file has the new member with every
// original comment line intact.
//
// One test, not two: the fixture server holds the crew file in memory for
// the whole run, so a second test asserting "no member yet" would race the
// first one's Apply instead of exercising a fresh state.
import { test, expect } from "@playwright/test";

test("adding a member in edit mode only lands in the file once Apply runs, keeping the original comments", async ({
  page,
  request,
}) => {
  await page.goto("/index.html");
  await page.getByRole("button", { name: "dev-impl" }).click();
  await page.getByRole("button", { name: /Add member/ }).click();
  await expect(page.getByRole("button", { name: "dev-member" })).toBeVisible();

  const beforeApply = await (await request.get("/api/crew")).json();
  expect(beforeApply.yaml).not.toContain("id: member");

  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator("[data-applied]")).toBeVisible();

  const afterApply = await (await request.get("/api/crew")).json();
  expect(afterApply.yaml).toContain("id: member");
  expect(afterApply.yaml).toContain("# The lead plans; it never writes code itself.");
  expect(afterApply.yaml).toContain("# e2e fixture (BBP-171)");
});
