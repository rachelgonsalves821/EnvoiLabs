import { expect, test } from "@playwright/test";
import axe from "axe-core";

test("reorders, edits and saves a fictional guide before approval", async ({ page }) => {
  await page.goto("/gate3-scoping-fixture?guide=1");
  const panel = page.getByRole("region", { name: "Review interview guide" });
  await expect(panel.getByRole("textbox", { name: "Question 1" }))
    .toHaveValue("Wouldn't you prefer a faster checkout?");
  const first = panel.getByRole("listitem").first();
  await first.getByRole("button", { name: "Move down" }).click();
  await expect(panel.getByRole("textbox", { name: "Question 2" }))
    .toHaveValue("Wouldn't you prefer a faster checkout?");
  await expect(panel.getByRole("listitem").nth(1).getByRole("button", { name: "Move up" }))
    .toBeFocused();
  await panel.getByRole("textbox", { name: "Question 2" })
    .fill("What did you compare during your last checkout?");
  await panel.getByRole("button", { name: "Save guide changes" }).click();
  await expect(panel.getByText("Guide updated.")).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "Question 2" }))
    .toHaveValue("What did you compare during your last checkout?");
  await expect(panel.getByRole("button", { name: "Approve guide" })).toBeEnabled();
});

test("rewrites an obvious leading question before fictional approval", async ({ page }) => {
  await page.goto("/gate3-scoping-fixture?guide=1");
  const panel = page.getByRole("region", { name: "Review interview guide" });
  await expect(panel.getByText("This may be leading. Ask about a past action instead.")).toBeVisible();
  await panel.getByRole("listitem").first().getByRole("button", { name: "Suggest rewrite" }).click();
  await expect(panel.getByRole("textbox", { name: "Question 1" }))
    .toHaveValue("Tell me about the last time you compared a price?");
  await panel.getByRole("button", { name: "Approve guide" }).click();
  await expect(panel.getByText("Guide approved.")).toBeVisible();
});

test("removes a withdrawn guide and blocks subsequent approval", async ({ page }) => {
  await page.goto("/gate3-scoping-fixture?guide=1");
  const panel = page.getByRole("region", { name: "Review interview guide" });
  await expect(panel.getByRole("textbox", { name: "Question 1" })).toBeVisible();
  await page.getByRole("button", { name: "Revoke fictional guide" }).click();
  await expect(panel.getByText("The guide is currently unavailable.")).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "Question 1" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Approve guide" })).toHaveCount(0);
});

test("reflows at 360px and 200% zoom with no serious whole-page axe findings", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/gate3-scoping-fixture?guide=1");
  await page.addScriptTag({ content: axe.source });
  await expect(page.getByRole("region", { name: "Review interview guide" })
    .getByRole("textbox", { name: "Question 1" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const violations = await page.evaluate(async () => {
    const results = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return results.violations.filter((item) => item.impact === "serious"
      || item.impact === "critical").map((item) => item.id);
  });
  expect(violations).toEqual([]);
});
