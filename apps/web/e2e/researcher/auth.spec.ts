import { expect, test } from "@playwright/test";

test("researcher sign-in submits the email and confirms the next step", async ({ page }) => {
  await page.route("**/api/researcher/auth/start", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ email: "researcher@example.test" });
    await route.fulfill({ json: { ok: true } });
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
        return verifications === 1
          ? route.fulfill({ status: 401 })
          : route.fulfill({ json: { ok: true } });
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

test("a stalled email response body releases the form for retry", async ({ page }) => {
  await page.addInitScript(() => {
    const networkFetch = window.fetch.bind(window);
    let stall = true;
    window.fetch = async (url, init) => {
      if (!stall || String(url) !== "/api/researcher/auth/start") return networkFetch(url, init);
      stall = false;
      // Headers arrive, then the connection stalls partway through the JSON body.
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode('{"ok":'));
          init?.signal?.addEventListener("abort", () => stream.error(new Error("Aborted")));
        },
      });
      return new Response(body, { headers: { "Content-Type": "application/json" } });
    };
  });
  await page.route("**/api/researcher/auth/start", (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/app/sign-in");
  const email = page.getByLabel("Email address");
  await email.fill("researcher@example.test");
  await page.clock.install();
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("button", { name: /Sending link/ })).toBeDisabled();
  await page.clock.fastForward(30_001);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be sent");
  await expect(email).toHaveValue("researcher@example.test");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
});

test("email sign-in requires an explicit confirmation", async ({ page }) => {
  await page.route("**/api/researcher/auth/start", (route) => route.fulfill({
    contentType: "text/html", body: "<h1>Temporarily unavailable</h1>",
  }));
  await page.goto("/app/sign-in");
  await page.getByLabel("Email address").fill("researcher@example.test");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be sent");
});

test("MFA only opens the workspace after the verify endpoint confirms", async ({ page }) => {
  let attempts = 0;
  await page.route("**/simulated-redirect", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/researcher/auth/mfa", (route) => {
    const { action } = route.request().postDataJSON();
    if (action === "status") return route.fulfill({ json: { state: "challenge", factorId: "factor" } });
    if (action === "challenge") return route.fulfill({ json: { challengeId: "challenge" } });
    if (action !== "verify") throw new Error(`Unexpected action: ${action}`);
    attempts += 1;
    if (attempts === 1) return route.fulfill({ json: { ok: false } });
    if (attempts === 2) return route.fulfill({ status: 302, headers: { Location: "/simulated-redirect" } });
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/app", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Workspace</h1>" }));
  await page.goto("/app/mfa");
  const code = page.getByLabel("Authenticator code");
  const verify = page.getByRole("button", { name: "Verify and continue" });
  for (const sample of ["000001", "000002"]) {
    await code.fill(sample);
    await verify.click();
    await expect(code).toHaveValue("");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be verified");
  }
  await code.fill("000003");
  await verify.click();
  await expect(page).toHaveURL(/\/app$/);
});
