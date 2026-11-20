import { expect, test } from "@playwright/test";

// Keep auth requests observable by the route mocks in every browser.
test.use({ serviceWorkers: "block" });

test("opens signup from the respondent home", async ({ page }) => {
  await page.goto("/r");
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/r\/signup$/);
  await expect(page.getByRole("textbox", { name: "Phone number" })).toBeVisible();
});

test("validates signup locally and verifies with the current phone and age attestation", async ({ page }) => {
  const requests: unknown[] = [];
  await page.route("**/api/respondent/auth/*", async (route) => {
    requests.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    await route.fulfill({ json: { ok: true } });
  });

  await page.setViewportSize({ width: 360, height: 540 });
  await page.goto("/r/signup");

  const phone = page.getByRole("textbox", { name: "Phone number" });
  const age = page.getByRole("checkbox", { name: "I’m 18 or older" });
  const send = page.getByRole("button", { name: "Text me a code" });
  const alert = page.getByRole("main").getByRole("alert");
  await expect(age).not.toBeChecked();
  await send.click();
  await expect(phone).toBeFocused();
  await expect(alert).toHaveText("Enter a 10-digit US phone number.");

  await phone.fill("(202) 555-0142");
  await send.click();
  await expect(age).toBeFocused();
  await expect(alert).toHaveText("Confirm that you’re 18 or older to continue.");
  expect(requests).toEqual([]);

  await age.check();
  await expect(age).toBeChecked();
  await age.focus();
  await page.keyboard.press("Tab");
  await expect(send).toBeFocused();
  await send.click();
  const startRequest = { path: "/api/respondent/auth/start", body: { phone: "+12025550142", ageAttested: true } };
  await expect.poll(() => requests).toEqual([startRequest]);
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeFocused();

  const code = page.getByRole("textbox", { name: "Verification code" });
  const verify = page.getByRole("button", { name: "Verify phone number" });
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  await code.fill("12");
  await verify.click();
  await expect(code).toBeFocused();
  await expect(alert).toHaveText("Enter all 6 digits of your code.");
  expect(requests).toHaveLength(1);

  await code.fill("012 345");
  await verify.click();
  await expect(page.getByRole("heading", { name: "Phone verified" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Go to your interviews" })).toHaveAttribute("href", "/r");
  expect(requests).toEqual([
    startRequest,
    { path: "/api/respondent/auth/verify", body: { phone: "+12025550142", code: "012345", ageAttested: true } },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test("offers recovery for rate limiting and rejected codes without exposing server details", async ({ page }) => {
  let sends = 0;
  await page.route("**/api/respondent/auth/start", async (route) => {
    sends++;
    if (sends === 1) {
      await route.fulfill({ status: 429, json: { message: "server detail" } });
    } else {
      await route.fulfill({ json: { ok: true } });
    }
  });
  await page.route("**/api/respondent/auth/verify", (route) =>
    route.fulfill({ status: 400, json: { message: "server detail" } }),
  );
  await page.goto("/r/signup");
  await page.getByRole("textbox", { name: "Phone number" }).fill("+12025550142");
  await page.getByRole("checkbox", { name: "I’m 18 or older" }).check();
  const send = page.getByRole("button", { name: "Text me a code" });
  const main = page.getByRole("main");
  const alert = main.getByRole("alert");
  await send.click();
  await expect(alert).toHaveText("Too many attempts. Wait before trying again.");
  await send.click();

  const code = page.getByRole("textbox", { name: "Verification code" });
  await code.fill("123456");
  await page.getByRole("button", { name: "Verify phone number" }).click();
  await expect(alert).toHaveText("This code couldn’t be verified. Check it or request a new one.");
  await page.getByRole("button", { name: "Request a new code" }).click();
  await expect(main.getByRole("status")).toHaveText("A new code was requested.");
  await expect(code).toHaveValue("");
  await page.getByRole("button", { name: "Change phone number" }).click();
  await expect(page.getByRole("textbox", { name: "Phone number" })).toHaveValue("+12025550142");
  expect(sends).toBe(3);
});

test("preserves the verification code through a stalled request and a malformed success response", async ({ page }) => {
  await page.route("**/api/respondent/auth/start", (route) => route.fulfill({ json: { ok: true } }));
  let attempts = 0;
  await page.route("**/api/respondent/auth/verify", async (route) => {
    attempts++;
    if (attempts === 1) return; // A connection that never returns response headers.
    if (attempts === 2) {
      await route.fulfill({ contentType: "text/html", body: "<p>Temporarily unavailable</p>" });
      return;
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/r/signup");
  await page.getByRole("textbox", { name: "Phone number" }).fill("2025550142");
  await page.getByRole("checkbox", { name: "I’m 18 or older" }).check();
  await page.getByRole("button", { name: "Text me a code" }).click();
  const code = page.getByRole("textbox", { name: "Verification code" });
  const verify = page.getByRole("button", { name: "Verify phone number" });
  const alert = page.getByRole("main").getByRole("alert");
  await code.fill("012345");
  await page.clock.install();
  await verify.click();
  await expect.poll(() => attempts).toBe(1);
  await expect(verify).toBeDisabled();
  await page.clock.fastForward(30_001);
  await expect(alert).toHaveText("The connection is unavailable. Try again in a moment.");
  await expect(code).toHaveValue("012345");
  await expect(verify).toBeEnabled();

  await verify.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(alert).toHaveText("The connection is unavailable. Try again in a moment.");
  await expect(code).toHaveValue("012345");
  await verify.click();
  await expect(page.getByRole("heading", { name: "Phone verified" })).toBeFocused();
  expect(attempts).toBe(3);
});
