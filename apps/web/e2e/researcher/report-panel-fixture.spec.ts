import { expect, test } from "@playwright/test";

test("keeps export focus and removes a revoked fictional report", async ({ page }) => {
  const downloads: string[] = [];
  page.on("download", (item) => downloads.push(item.suggestedFilename()));
  await page.goto("/gate3-report-fixture");
  const panel = page.getByRole("region", { name: "Research report" });
  const exportButton = panel.getByRole("button", { name: "Download themes and quotes CSV" });
  await expect(exportButton).toBeVisible();
  await expect(panel.getByText("A receipt helps.")).toBeVisible();
  await exportButton.focus();
  await page.keyboard.press("Enter");
  const pending = panel.getByRole("button", { name: "Checking report…" });
  await expect(pending).toBeFocused();
  await expect(pending).toHaveAttribute("aria-disabled", "true");
  await expect(panel.getByText("A receipt helps.")).toHaveCount(0);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-fixture-revoke]")?.click());
  const retry = panel.getByRole("button", { name: "Check again" });
  await expect(retry).toBeFocused();
  await expect(panel.getByText("The report is currently unavailable.")).toBeVisible();
  expect(downloads).toEqual([]);
});

test("keeps the fictional report readable at mobile width and 200% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/gate3-report-fixture");
  const panel = page.getByRole("region", { name: "Research report" });
  await expect(panel.getByText("A receipt helps.")).toBeVisible();
  const action = panel.getByRole("button", { name: "Download themes and quotes CSV" });
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(360);
});
