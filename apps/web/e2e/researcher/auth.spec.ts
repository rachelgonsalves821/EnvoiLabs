import { expect, test } from "@playwright/test";

test("researcher sign-in submits the email and confirms the next step", async ({ page }) => {
  await page.route("**/api/researcher/auth/start", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ email: "researcher@example.test" });
    await route.fulfill({ status: 202 });
  });

  await page.goto("/app/sign-in?error=expired");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("no longer valid");
  await page.getByLabel("Email address").fill("researcher@example.test");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.getByLabel("Email address")).toHaveValue("");
});

test("researcher sets up an authenticator and can retry verification", async ({ page }) => {
  let verifications = 0;
  let challenges = 0;
  await page.route("**/api/researcher/auth/mfa", async (route) => {
    const body = route.request().postDataJSON();
    switch (body.action) {
      case "status":
        return route.fulfill({ json: { state: "enroll" } });
      case "enroll":
        return route.fulfill({ json: { factorId: "factor-1", secret: "JBSWY3DPEHPK3PXP" } });
      case "challenge":
        expect(body).toEqual({ action: "challenge", factorId: "factor-1" });
        return route.fulfill({ json: { challengeId: `challenge-${++challenges}` } });
      case "verify":
        expect(body).toEqual({
          action: "verify", factorId: "factor-1", challengeId: `challenge-${challenges}`,
          code: verifications++ === 0 ? "000001" : "000002",
        });
        return route.fulfill({ status: verifications === 1 ? 401 : 204 });
      default:
        throw new Error("Unexpected MFA request.");
    }
  });
  await page.route("**/app", (route) => route.fulfill({
    contentType: "text/html", body: "<h1>Researcher workspace</h1>",
  }));

  await page.goto("/app/mfa");
  await page.getByRole("button", { name: "Show setup key" }).click();
  await expect(page.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
  const code = page.getByLabel("Authenticator code");
  await code.fill("000001");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be verified");
  await expect(code).toHaveValue("");
  await code.fill("000002");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/app$/);
  expect(challenges).toBe(2);
});

test("the MFA page redirects when the sign-in session is missing", async ({ page }) => {
  await page.route("**/api/researcher/auth/mfa", (route) => route.fulfill({ status: 401 }));
  await page.goto("/app/mfa");
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
});

for (const interruptedAction of ["enroll", "challenge", "verify"] as const) {
  test(`a session expiring during ${interruptedAction} returns to email sign-in`, async ({ page }) => {
    let expired = false;
    await page.route("**/api/researcher/auth/mfa", async (route) => {
      const { action } = route.request().postDataJSON();
      if (action === interruptedAction) expired = true;
      if (expired) return route.fulfill({ status: 401 });
      if (action === "status") {
        const state = interruptedAction === "enroll"
          ? { state: "enroll" }
          : { state: "challenge", factorId: "factor-1" };
        return route.fulfill({ json: state });
      }
      if (action === "challenge") return route.fulfill({ json: { challengeId: "challenge-1" } });
      throw new Error(`Unexpected MFA action: ${action}`);
    });

    await page.goto("/app/mfa");
    if (interruptedAction === "enroll") {
      await page.getByRole("button", { name: "Show setup key" }).click();
    } else {
      await page.getByLabel("Authenticator code").fill("000123");
      await page.getByRole("button", { name: "Verify and continue" }).click();
    }
    await expect(page).toHaveURL(/\/app\/sign-in\?error=session$/);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("session expired");
    await expect(page.getByLabel("Email address")).toBeEditable();
  });
}
