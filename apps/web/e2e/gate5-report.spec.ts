import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { deliveredEmail, localService, loopbackOrigin, totp } from "./support/disposable-auth";

const studyId = "90600000-0000-4000-8000-000000000001";
const organizationId = "90100000-0000-4000-8000-000000000001";

async function signInResearcher(browser: Browser, origin: string, orgId: string) {
  const db = localService();
  const email = `gate5-report-${randomUUID()}@example.test`;
  const user = await db.auth.admin.createUser({ email, email_confirm: true });
  if (user.error || !user.data.user) throw new Error("Fictional researcher setup failed");
  const researcher = await db.from("researchers").insert({
    auth_user_id: user.data.user.id, organization_id: orgId,
    terms_version: "fictional-report-test", terms_accepted_at: new Date().toISOString(),
  });
  if (researcher.error) throw new Error("Fictional researcher membership failed");
  const context = await browser.newContext({ baseURL: origin, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto("/app/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  const link = await deliveredEmail(page, email, origin, "/api/researcher/auth/callback");
  await page.goto(link.href);
  await expect(page).toHaveURL(/\/app\/mfa$/);
  return { page, context };
}

async function completeMfa(page: Page) {
  await page.getByRole("button", { name: "Show setup key" }).click();
  const secret = (await page.locator("main code").textContent())?.trim();
  if (!secret) throw new Error("Fictional MFA setup key missing");
  await page.getByLabel("Authenticator code").fill(totp(secret, Date.now()));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("heading", { name: "New study" })).toBeVisible();
}

test.describe("Gate 5 mounted current-qualified report", () => {
  test.skip(process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1" ||
    process.env.ENVOI_GATE5_REPORT_FIXTURE !== "1",
  "Requires isolated local Auth and the fictional nonempty report SQL fixture.");
  test.skip(({ browserName }) => browserName !== "chromium", "Disposable Chromium Auth run.");

  test("AAL2 tenant read, nonempty quote, CSV and consent revocation", async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const origin = loopbackOrigin(baseURL);
    const db = localService();
    const owner = await signInResearcher(browser, origin, organizationId);
    try {
      const route = `/api/researcher/studies/${studyId}/report`;
      const preMfa = await owner.page.request.get(route);
      expect(preMfa.status()).toBe(403);
      expect(preMfa.headers()["cache-control"]).toBe("private, no-store");
      await completeMfa(owner.page);
      const ready = await owner.page.request.get(route);
      expect(ready.status()).toBe(200);
      expect(ready.headers()["cache-control"]).toBe("private, no-store");
      const payload = await ready.json();
      expect(payload.summary.themes).toHaveLength(1);
      expect(payload.summary.themes[0].supportingQuotes[0].exactText).toBe("ordered soup");
      expect(JSON.stringify(payload)).not.toContain("Private fictional reason");

      const otherOrg = await db.from("organizations").insert({
        name: "Other fictional report organization",
      }).select("id").single();
      if (otherOrg.error || !otherOrg.data) throw new Error("Other organization setup failed");
      const other = await signInResearcher(browser, origin, otherOrg.data.id);
      try {
        await completeMfa(other.page);
        const denied = await other.page.request.get(route);
        expect(denied.status()).toBe(403);
        expect(denied.headers()["cache-control"]).toBe("private, no-store");
      } finally { await other.context.close(); }

      await owner.page.goto(`/app/studies/${studyId}`);
      await expect(owner.page.getByRole("heading", { name: "Research report" })).toBeVisible();
      await expect(owner.page.getByText("One fictional soup order")).toBeVisible();
      await expect(owner.page.getByText("ordered soup", { exact: true })).toBeVisible();
      const downloadPromise = owner.page.waitForEvent("download");
      await owner.page.getByRole("button", { name: "Download themes and quotes CSV" }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe("envoi-labs-themes-and-quotes.csv");

      const revoked = await db.from("consents").insert({
        respondent_id: "90500000-0000-4000-8000-000000000001",
        purpose: "researcher_access", granted: false,
        text_version: "fictional-withdrawal",
        created_at: new Date(Date.now() + 2000).toISOString(),
      });
      if (revoked.error) throw new Error("Fictional consent withdrawal failed");
      expect((await owner.page.request.get(route)).status()).toBe(404);
      const unexpectedDownload = owner.page.waitForEvent("download", { timeout: 2000 })
        .then(() => true, () => false);
      await owner.page.getByRole("button", { name: "Download themes and quotes CSV" }).click();
      expect(await unexpectedDownload).toBe(false);
      await expect(owner.page.getByText("The report is currently unavailable.")).toBeVisible();
    } finally { await owner.context.close(); }
  });
});
