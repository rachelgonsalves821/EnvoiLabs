import { expect, test } from "@playwright/test";

test("a direct visit to the researcher workspace requires authentication", async ({ page, request }) => {
  const response = await request.get("/app", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toMatch(/\/app\/sign-in$/);

  await page.goto("/app");
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
  await expect(page.locator("#new-study")).toHaveCount(0);
});

test("the unauthenticated MFA API returns no identity or session", async ({ request, baseURL }) => {
  const response = await request.post("/api/researcher/auth/mfa", {
    headers: { Origin: new URL(baseURL ?? "http://127.0.0.1:3100").origin },
    data: { action: "status" },
  });

  // Browser CI has no provider configuration. A configured provider instead rejects an absent session.
  expect([401, 403, 503]).toContain(response.status());
  expect(await response.json()).toEqual({ ok: false });
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["set-cookie"]).toBeUndefined();
});

test("respondent onboarding and PWA assets stay public", async ({ page, request }) => {
  await page.goto("/r");
  await page.getByRole("link", { name: "Sign in or get started" }).click();
  await expect(page).toHaveURL(/\/r\/signup$/);
  await expect(page.getByRole("textbox", { name: "Email address" })).toBeVisible();
  const account = await request.get("/r/status", { maxRedirects: 0 });
  expect(account.status()).toBe(307);
  expect(account.headers().location).toMatch(/\/r\/signup$/);

  const [manifest, worker, icon] = await Promise.all([
    request.get("/r/manifest.webmanifest"),
    request.get("/r/sw.js"),
    request.get("/r/install-icon/192"),
  ]);
  for (const resource of [manifest, worker, icon]) expect(resource.ok()).toBe(true);
  expect((await manifest.json()).start_url).toBe("/r");
  expect(worker.headers()["content-type"]).toMatch(/javascript/);
  expect(icon.headers()["content-type"]).toMatch(/image\/png/);
});
