import { expect, test, type Locator } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function expectTouchTarget(control: Locator) {
  const box = await control.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
}

test("keeps keyboard focus on the code request while it is pending and can retry from the error", async ({ page }) => {
  let attempts = 0;
  let replyToFirst: (() => Promise<void>) | undefined;
  await page.route("**/api/respondent/auth/start", async (route) => {
    attempts++;
    if (attempts === 1) {
      replyToFirst = () => route.fulfill({ status: 503, json: { ok: false } });
      return;
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/r/signup");
  await page.getByRole("textbox", { name: "Phone number" }).fill("2025550142");
  const age = page.getByRole("checkbox", { name: "I’m 18 or older" });
  await age.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  const send = page.getByRole("button", { name: "Text me a code" });
  await expect(send).toBeFocused();
  await page.keyboard.press("Enter");
  const main = page.getByRole("main");
  await expect(main.getByRole("status")).toHaveText("Requesting a code…");
  await expect(send).toBeDisabled();
  await expect(send).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => typeof replyToFirst).toBe("function");
  await replyToFirst!();
  await expect(main.getByRole("alert")).toHaveText("The connection is unavailable. Try again in a moment.");
  await expect(send).toBeFocused();
  expect(attempts).toBe(1);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeFocused();
  expect(attempts).toBe(2);
});

test("supports phone widths, reduced motion and keyboard navigation on the shell and signup", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/r");
  const echo = page.locator(".ev-echo");
  await expect(echo).toHaveCount(1);
  await expect(echo).toHaveAttribute("aria-hidden", "true");
  await expect(echo).toHaveCSS("animation-name", "none");
  const signup = page.getByRole("link", { name: "Create an account" });
  const help = page.getByRole("button", { name: "How interviews work" });
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 600 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expectTouchTarget(signup);
    await expectTouchTarget(help);
  }
  await help.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "How interviews work" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("animation-name", "none");
  await expectTouchTarget(dialog.getByRole("button", { name: "Close" }));
  await page.keyboard.press("Escape");
  await expect(help).toBeFocused();

  await signup.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/r\/signup$/);
  const phone = page.getByRole("textbox", { name: "Phone number" });
  const attestation = page.locator("label").filter({ has: page.getByRole("checkbox") });
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 600 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expectTouchTarget(phone);
    await expectTouchTarget(attestation);
    await expectTouchTarget(page.getByRole("button", { name: "Text me a code" }));
  }
});
