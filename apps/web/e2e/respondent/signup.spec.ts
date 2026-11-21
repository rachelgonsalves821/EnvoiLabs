import { expect, test } from "@playwright/test";

// Keep auth requests observable by the route mocks in every browser.
test.use({ serviceWorkers: "block" });

const email = "respondent@example.com";
const emailLabel = "Email address";
const ageLabel = "I’m 18 or older";
const sendLabel = "Email me a sign-in link";
const sentTitle = "Check your email";
const startPath = "/api/respondent/auth/start";

test("opens email sign-in from the respondent home", async ({ page }) => {
  await page.goto("/r");
  await page.getByRole("link", { name: "Sign in or get started" }).click();
  await expect(page).toHaveURL(/\/r\/signup$/);
  await expect(page.getByRole("textbox", { name: emailLabel })).toBeVisible();
});

test("requires an email address and age confirmation before requesting a link", async ({ page }) => {
  const requests: unknown[] = [];
  await page.route(`**${startPath}`, async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });

  await page.setViewportSize({ width: 360, height: 540 });
  await page.goto("/r/signup");

  const address = page.getByRole("textbox", { name: emailLabel });
  const age = page.getByRole("checkbox", { name: ageLabel });
  const send = page.getByRole("button", { name: sendLabel });
  const alert = page.getByRole("main").getByRole("alert");
  await expect(address).toHaveAttribute("autocomplete", "email");
  await expect(age).not.toBeChecked();
  await send.click();
  await expect(address).toBeFocused();
  await expect(alert).toHaveText("Enter a valid email address.");

  await address.fill("Respondent@EXAMPLE.COM");
  await send.click();
  await expect(age).toBeFocused();
  await expect(alert).toHaveText("Confirm that you’re 18 or older to continue.");
  expect(requests).toEqual([]);

  await age.check();
  await age.focus();
  await page.keyboard.press("Tab");
  await expect(send).toBeFocused();
  await send.click();
  await expect(page.getByRole("heading", { name: sentTitle })).toBeFocused();
  expect(requests).toEqual([{ email, ageAttested: true }]);
  await expect(page.getByText("Open the sign-in link in the same browser you used to request it.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test("offers retry, resend and email editing without exposing provider details", async ({ page }) => {
  const requests: unknown[] = [];
  await page.route(`**${startPath}`, async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length <= 2) {
      await route.fulfill({ status: requests.length === 1 ? 429 : 400, json: { message: "server detail" } });
    } else {
      await route.fulfill({ json: { ok: true } });
    }
  });

  await page.goto("/r/signup");
  await page.getByRole("textbox", { name: emailLabel }).fill(email);
  await page.getByRole("checkbox", { name: ageLabel }).check();
  const send = page.getByRole("button", { name: sendLabel });
  const main = page.getByRole("main");
  const alert = main.getByRole("alert");
  await send.click();
  await expect(alert).toHaveText("Too many attempts. Wait before trying again.");
  await send.click();
  await expect(alert).toHaveText("The link request failed. Check your email address and try again.");
  await send.click();
  await expect(page.getByRole("heading", { name: sentTitle })).toBeFocused();

  await page.getByRole("button", { name: "Request a new link" }).click();
  await expect(main.getByRole("status")).toHaveText("A new link was requested.");
  await page.getByRole("button", { name: "Change email address" }).click();
  await expect(page.getByRole("textbox", { name: emailLabel })).toHaveValue(email);
  expect(requests).toEqual(Array.from({ length: 4 }, () => ({ email, ageAttested: true })));
});

test("preserves the email after a stalled request and malformed success response", async ({ page }) => {
  let attempts = 0;
  await page.route(`**${startPath}`, async (route) => {
    attempts++;
    if (attempts === 1) return; // A connection that never returns response headers.
    if (attempts === 2) {
      await route.fulfill({ contentType: "text/html", body: "<p>Temporarily unavailable</p>" });
      return;
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/r/signup");
  const address = page.getByRole("textbox", { name: emailLabel });
  const send = page.getByRole("button", { name: sendLabel });
  const alert = page.getByRole("main").getByRole("alert");
  await address.fill(email);
  await page.getByRole("checkbox", { name: ageLabel }).check();
  await page.clock.install();
  await send.click();
  await expect.poll(() => attempts).toBe(1);
  await expect(send).toBeDisabled();
  await page.clock.fastForward(30_001);
  await expect(alert).toHaveText("The connection is unavailable. Try again in a moment.");
  await expect(address).toHaveValue(email);
  await expect(send).toBeEnabled();

  await send.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(alert).toHaveText("The connection is unavailable. Try again in a moment.");
  await expect(address).toHaveValue(email);
  await send.click();
  await expect(page.getByRole("heading", { name: sentTitle })).toBeFocused();
  expect(attempts).toBe(3);
});

test("protects account status and offers recovery for an expired link", async ({ page }) => {
  await page.goto("/r/status");
  await expect(page).toHaveURL(/\/r\/signup$/);
  await page.goto("/r/signup?error=expired");
  await expect(page.getByRole("alert")).toHaveText(
    "This link couldn’t sign you in. Request a new link and open it in this browser.",
  );
  await expect(page.getByRole("button", { name: sendLabel })).toBeVisible();
});
