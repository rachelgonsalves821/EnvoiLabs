import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { deliveredCallback, localService, loopbackOrigin, totp, useDefaultTemplate } from
  "../support/disposable-auth";

test.describe("authorized researcher accessibility with disposable Auth", () => {
  test.skip(process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1",
    "Requires the disposable loopback Supabase Auth stack.");
  test.skip(({ browserName }) => browserName !== "chromium",
    "The disposable local Auth workflow installs Chromium.");

  test("whole workspace and study-tracking pages have no serious or critical axe findings",
    async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      const origin = loopbackOrigin(baseURL);
      const service = localService();
      const email = `researcher-a11y-${randomUUID()}@example.test`;
      const created = await service.auth.admin.createUser({ email,
        email_confirm: !useDefaultTemplate });
      if (created.error || !created.data.user) throw new Error("Synthetic researcher creation failed.");
      const organization = await service.from("organizations")
        .insert({ name: "Researcher accessibility fixture" }).select("id").single();
      if (organization.error || !organization.data) throw new Error("Synthetic organization creation failed.");
      const membership = await service.from("researchers").insert({
        auth_user_id: created.data.user.id, organization_id: organization.data.id,
        terms_version: "synthetic-test", terms_accepted_at: new Date().toISOString(),
      });
      expect(membership.error).toBeNull();

      await page.goto("/app/sign-in");
      await page.getByLabel("Email address").fill(email);
      await page.getByRole("button", { name: "Send sign-in link" }).click();
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
      await page.goto(await deliveredCallback(page, email, origin, "/api/researcher/auth/callback"));
      await expect(page).toHaveURL(/\/app\/mfa$/);
      await page.getByRole("button", { name: "Show setup key" }).click();
      const secret = (await page.locator("main code").textContent())?.trim();
      if (!secret) throw new Error("Synthetic authenticator key was missing.");
      await page.getByLabel("Authenticator code").fill(totp(secret, Date.now()));
      await page.getByRole("button", { name: "Verify and continue" }).click();
      await expect(page).toHaveURL(/\/app$/);
      await expect(page.getByRole("heading", { name: "New study" })).toBeVisible();
      await page.addScriptTag({ content: axe.source });
      expect(await violations(page)).toEqual([]);

      const study = await service.from("studies").insert({ organization_id: organization.data.id,
        title: "Fictional tracking study", state: "fielding", target_completes: 3,
        length_minutes: 8 }).select("id").single();
      if (study.error || !study.data) throw new Error("Synthetic tracking study creation failed.");
      await page.goto(`/app/studies/${study.data.id}`);
      await expect(page.getByRole("heading", { name: "Fictional tracking study" })).toBeVisible();
      await page.addScriptTag({ content: axe.source });
      expect(await violations(page)).toEqual([]);
    });
});

async function violations(page: import("@playwright/test").Page) {
  return page.locator("html").evaluate(async (root) => {
    const browserAxe = (window as unknown as { axe: typeof axe }).axe;
    const results = await browserAxe.run(root, { runOnly: { type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return results.violations.filter((item) => item.impact === "serious"
      || item.impact === "critical").map((item) => ({ id: item.id,
      targets: item.nodes.map((node) => node.target) }));
  });
}
