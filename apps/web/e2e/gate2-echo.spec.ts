import { expect, test } from "@playwright/test";

test.describe("respondent Echo", () => {
  test.skip(process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1", "Requires disposable local Auth.");
  test.skip(({ browserName }) => browserName !== "chromium", "Runs in the disposable Chromium Auth job.");

  test("keeps a visible, decorative fallback when WebGL is unavailable", async ({ page }) => {
    await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
    await page.goto("/r");
    const echo = page.locator(".respondent-echo .ev-echo");
    await expect(echo).toBeVisible();
    await expect(echo).toHaveAttribute("aria-hidden", "true");
    await expect(echo.locator("canvas")).toHaveAttribute("aria-hidden", "true");
    expect(await echo.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe("rgba(0, 0, 0, 0)");
  });

  test("draws a square orb from its lazy WebGL module when supported", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/r");
    const supported = await page.evaluate(() =>
      Boolean(document.createElement("canvas").getContext("webgl")));
    test.skip(!supported, "Browser has no WebGL; the fallback case covers that path.");
    const canvas = page.locator(".respondent-echo .ev-echo canvas");
    await expect.poll(() => canvas.evaluate((element) => {
      const target = element as HTMLCanvasElement;
      return target.clientWidth > 0 && target.width === target.height &&
        target.width >= target.clientWidth && target.width <= target.clientWidth * 2;
    })).toBe(true);
    await expect(canvas).toHaveCSS("pointer-events", "none");
  });
});
