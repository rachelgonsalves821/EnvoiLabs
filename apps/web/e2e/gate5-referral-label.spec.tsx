import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.describe("fictional delivered referral copy", () => {
  test.skip(process.env.ENVOI_GATE5_REFERRAL_LABEL_FIXTURE !== "1",
    "Opt-in rendered copy check; no account or provider action.");

  for (const width of [320, 360]) test(`keeps mock label beside a receipt at ${width}px after reload`,
    async ({ page }) => {
      const html = await readFile("apps/web/.next/gate5-referral-label.html", "utf8");
      await page.setViewportSize({ width, height: 640 });
      await page.goto(`data:text/html,${encodeURIComponent(html)}`);
      const label = page.getByTestId("gate5-mocked-referral-inline");
      await expect(label).toContainText("Payout mocked. No Visa sent.");
      await expect(page.locator("main p")).toContainText("Receipt 22222222");
      await page.reload();
      await expect(label).toBeVisible();
      await expect(label).toContainText("No Visa sent.");
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
    });
  for (const width of [320, 360]) test(`labels every fictional payout state at ${width}px after reload`,
    async ({ page }) => {
      const html = await readFile("apps/web/.next/gate5-payout-states.html", "utf8");
      await page.setViewportSize({ width, height: 640 });
      await page.goto(`data:text/html,${encodeURIComponent(html)}`);
      for (const state of ["pending", "ordered", "delivered", "failed"]) {
        const row = page.locator(`[data-state="${state}"]`);
        await expect(row.getByTestId("gate5-mocked-payout-inline")).toBeVisible();
        await expect(row.getByTestId("gate5-mocked-referral-inline")).toBeVisible();
        await expect(row.getByTestId("gate5-mocked-referral-inline"))
          .toContainText("Fictional product test");
        if (state !== "delivered") await expect(row).not.toContainText("Receipt");
      }
      await page.reload();
      await expect(page.getByTestId("gate5-mocked-payout-inline")).toHaveCount(4);
      await expect(page.getByTestId("gate5-mocked-referral-inline")).toHaveCount(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
    });
});
