import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { devices, expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { deliveredEmail, localService, loopbackOrigin } from "./support/disposable-auth";

test.skip(process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1" ||
  process.env.ENVOI_GATE2_EARNINGS_ENABLED !== "true",
"Requires a disposable local Auth/database stack and the draft Earnings flag.");
test.skip(({ browserName }) => browserName !== "chromium", "Local Chromium Earnings check.");

async function signedInRespondent(browser: Browser, origin: string, email: string) {
  const context = await browser.newContext({ ...devices["Pixel 7"], viewport: { width: 320, height: 700 }, baseURL: origin });
  const page = await context.newPage();
  await page.goto("/r/signup");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("checkbox", { name: /18 or older/ }).check();
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const link = await deliveredEmail(page, email, origin, "/api/respondent/auth/callback");
  await page.goto(link.href);
  await expect(page.getByRole("heading", { name: "You’re signed in" })).toBeVisible();
  await page.getByRole("link", { name: "Profile and privacy choices" }).click();
  await page.getByLabel("What’s your age range?").selectOption("18-24");
  await page.getByLabel("How do you describe your gender?").selectOption("undisclosed");
  await page.getByLabel("Are you currently in school?").selectOption("year_2");
  await page.getByLabel("Do you live on campus?").selectOption("true");
  await page.getByLabel("How often do you shop online?").selectOption("weekly");
  await page.getByLabel("What’s your ZIP code?").fill("02139");
  await page.getByLabel("How many times do you order food in a typical week?").fill("3");
  await page.getByRole("checkbox", { name: "Food and drink" }).check();
  await page.getByRole("checkbox", { name: "Technology" }).check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Choose what to share" })).toBeVisible();
  for (const name of ["Record my voice answers", "Turn my voice answers into text",
    "Keep my study answers", "Share my redacted answers with researchers"]) {
    await page.getByRole("checkbox", { name }).check();
  }
  await page.getByRole("button", { name: "Save privacy choices" }).click();
  await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();
  return context;
}

function seedSyntheticVesting(container: string, respondentId: string) {
  if (!/^supabase_db_[a-z0-9-]+$/.test(container) ||
      !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(respondentId)) {
    throw new Error("The disposable database fixture identifiers are invalid.");
  }
  execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-c",
    `insert into public.gate2_referral_vestings (referrer_id, verified_profile_count, bonus_cents, idempotency_key) values ('${respondentId}', 5, 500, 'gate4-synthetic:${respondentId}')`],
  { stdio: "pipe" });
}

test("signed-in Earnings keeps a synthetic vesting private across two respondents", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const origin = loopbackOrigin(baseURL);
  const container = process.env.GATE4_DISPOSABLE_DB_CONTAINER;
  if (!container) throw new Error("A disposable database container is required.");
  const firstEmail = `gate4-earnings-a-${randomUUID()}@example.test`;
  const secondEmail = `gate4-earnings-b-${randomUUID()}@example.test`;
  const first = await signedInRespondent(browser, origin, firstEmail);
  let second: BrowserContext | undefined;
  try {
    const service = localService();
    const users = await service.auth.admin.listUsers();
    const firstUser = users.data?.users.find((user) => user.email === firstEmail);
    if (users.error || !firstUser) throw new Error("First synthetic auth account is missing.");
    const respondent = await service.from("respondents").select("id").eq("auth_user_id", firstUser.id).single();
    if (respondent.error || !respondent.data) throw new Error("First synthetic respondent is missing.");
    seedSyntheticVesting(container, respondent.data.id);
    second = await signedInRespondent(browser, origin, secondEmail);

    const a = await first.newPage();
    const b = await second.newPage();
    const firstResponse = await a.goto("/r/earnings");
    const secondResponse = await b.goto("/r/earnings");
    expect(firstResponse?.status()).toBe(200);
    expect(secondResponse?.status()).toBe(200);
    await expect(a.getByRole("heading", { name: "Earnings" })).toBeVisible();
    await expect(a.getByText("$5.00 bonus vested", { exact: false })).toBeVisible();
    await expect(b.getByText("A $5.00 bonus vests after five verified profiles.")).toBeVisible();
    await expect(b.getByText("bonus vested", { exact: false })).toHaveCount(0);
    for (const page of [a, b]) {
      const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth }));
      expect(layout.width).toBe(layout.viewport);
      await expect(page.getByRole("link", { name: "Your studies" })).toHaveAttribute("href", "/r");
    }
    const firstApi = await a.request.get(origin + "/api/respondent/earnings");
    const secondApi = await b.request.get(origin + "/api/respondent/earnings");
    expect(firstApi.status()).toBe(200);
    expect(secondApi.status()).toBe(200);
    expect(firstApi.headers()["cache-control"]).toBe("private, no-store");
    expect(secondApi.headers()["cache-control"]).toBe("private, no-store");
    expect((await firstApi.json()).referral.vestedBonusCents).toBe(500);
    expect((await secondApi.json()).referral.vestedBonusCents).toBe(0);
  } finally {
    await first.close();
    await second?.close();
  }
});
