import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createScreeningAdapter } from "@envoi-labs/services/screening-adapter";
import { screenSubmittedAnswer } from "@envoi-labs/services/screening";
import { deliveredEmail, localService, loopbackOrigin } from "./support/disposable-auth";

test.describe("Gate 2 private screening sheet", () => {
  test.skip(process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1", "Requires disposable local Auth and database.");
  test.skip(({ browserName }) => browserName !== "chromium", "Runs in the disposable Chromium Auth job.");

  test("a signed-in respondent submits text, reloads pending, and cannot trigger eligibility", async ({ browser, baseURL }) => {
    test.setTimeout(150_000);
    const origin = loopbackOrigin(baseURL);
    const db = localService();
    const email = `gate2-screen-${randomUUID()}@example.test`;
    const question = "Have you worked as a hospital nurse in the past 12 months?";
    const answerText = "I worked as a hospital nurse last year.";
    const context = await browser.newContext({ baseURL: origin });
    try {
      const page = await context.newPage();
      await page.goto("/r/signup");
      await page.getByLabel("Email address").fill(email);
      await page.getByRole("checkbox", { name: /18 or older/ }).check();
      await page.getByRole("button", { name: "Email me a sign-in link" }).click();
      const link = await deliveredEmail(page, email, origin, "/api/respondent/auth/callback");
      await page.goto(link.href);
      await expect(page.getByRole("heading", { name: "You’re signed in" })).toBeVisible();

      const users = await db.auth.admin.listUsers();
      expect(users.error).toBeNull();
      const user = users.data?.users.find((candidate) => candidate.email === email);
      if (!user) throw new Error("Disposable respondent user is missing.");
      const account = await db.from("respondents").select("id").eq("auth_user_id", user.id).single();
      if (account.error || !account.data) throw new Error("Disposable respondent profile is missing.");

      const org = await db.from("organizations").insert({ name: "Synthetic screening study" }).select("id").single();
      if (org.error || !org.data) throw new Error("Disposable organization is missing.");
      const approver = await db.auth.admin.createUser({
        email: `gate2-approver-${randomUUID()}@example.test`, email_confirm: true,
      });
      if (approver.error || !approver.data.user) throw new Error("Disposable rule approver is missing.");
      const researcher = await db.from("researchers").insert({
        auth_user_id: approver.data.user.id, organization_id: org.data.id,
        terms_version: "synthetic-test", terms_accepted_at: new Date().toISOString(),
      }).select("id").single();
      if (researcher.error || !researcher.data) throw new Error("Disposable researcher is missing.");
      const study = await db.from("studies").insert({
        organization_id: org.data.id, title: "Synthetic screening study", state: "fielding",
        target_completes: 10, length_minutes: 10,
        deadline_at: new Date(Date.now() + 86_400_000).toISOString(),
      }).select("id").single();
      if (study.error || !study.data) throw new Error("Disposable study is missing.");
      const guide = await db.from("guide_questions").insert({
        study_id: study.data.id, position: 1, text: "Describe a recent shift.",
      });
      expect(guide.error).toBeNull();
      const criterion = await db.from("criteria").insert({
        study_id: study.data.id, kind: "must", attribute_key: "nurse",
        operator: "eq", value_json: true,
        text: "Worked as a hospital nurse in the past 12 months",
      }).select("id").single();
      if (criterion.error || !criterion.data) throw new Error("Disposable criterion is missing.");
      const rule = await db.from("gate2_screening_rules").insert({
        study_id: study.data.id, criterion_id: criterion.data.id,
        version: 1, criterion_kind: "must", criterion_text: "Worked as a hospital nurse in the past 12 months",
        timeframe_text: "past 12 months", question,
        approved_by: researcher.data.id, approved_at: new Date(Date.now() - 1000).toISOString(),
      }).select("id").single();
      if (rule.error || !rule.data) throw new Error(`Disposable screening rule is missing: ${rule.error?.message}`);
      const offer = await db.from("invites").insert({
        study_id: study.data.id, respondent_id: account.data.id,
        state: "screening", reward_cents: 100,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }).select("id").single();
      if (offer.error || !offer.data) throw new Error("Disposable screening offer is missing.");
      const consent = await db.from("consents").insert({
        respondent_id: account.data.id, purpose: "retention", granted: true,
        text_version: "synthetic-screening-test",
      });
      expect(consent.error).toBeNull();

      const sheetPath = `**/api/respondent/screening/${offer.data.id}`;
      await page.route(sheetPath, async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        const sheet = await response.json() as Record<string, unknown>;
        await route.fulfill({ response, json: { ...sheet, inviteId: randomUUID() } });
      });
      await page.goto("/r");
      await page.getByRole("link", { name: "Answer screening questions" }).click();
      await expect(page).toHaveURL(origin + `/r/screening/${offer.data.id}`);
      await expect(page.getByText(question)).toHaveCount(0);
      await expect(page.getByLabel("Your answer")).toHaveCount(0);
      await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
      await page.unroute(sheetPath);
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.getByText(question)).toBeVisible();
      await page.getByLabel("Your answer").fill(answerText);
      await page.getByRole("button", { name: "Submit answer" }).click();
      await expect(page.getByText("Your answer is awaiting review.")).toBeVisible();
      await page.reload();
      await expect(page.getByText(question)).toBeVisible();
      await expect(page.getByText("Your answer is awaiting review.")).toBeVisible();
      await expect(page.getByText(answerText)).toHaveCount(0);

      const withdrawal = await db.from("consents").insert({
        respondent_id: account.data.id, purpose: "retention", granted: false,
        text_version: "synthetic-screening-withdrawal",
      });
      expect(withdrawal.error).toBeNull();
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(page.getByText(question)).toHaveCount(0);
      await expect(page.getByLabel("Your answer")).toHaveCount(0);
      await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
      expect((await page.request.get(`/api/respondent/screening/${offer.data.id}`)).status()).toBe(404);

      const events = await db.from("gate2_screening_events").select("id").eq("rule_id", rule.data.id);
      expect(events.error).toBeNull();
      expect(events.data).toEqual([]);
      const unchanged = await db.from("invites").select("state").eq("id", offer.data.id).single();
      expect(unchanged.error).toBeNull();
      expect(unchanged.data?.state).toBe("screening");
      const stranger = await browser.newContext({ baseURL: origin });
      try {
        const response = await stranger.request.get(`/api/respondent/screening/${offer.data.id}`);
        expect(response.status()).toBe(403);
      } finally {
        await stranger.close();
      }

      // A separate synthetic respondent verifies the retired raw decision
      // adapter cannot advance an offer without a qualified source.
      const qualifiedEmail = `gate2-screen-qualified-${randomUUID()}@example.test`;
      const qualifiedContext = await browser.newContext({ baseURL: origin });
      try {
        const qualifiedPage = await qualifiedContext.newPage();
        await qualifiedPage.goto("/r/signup");
        await qualifiedPage.getByLabel("Email address").fill(qualifiedEmail);
        await qualifiedPage.getByRole("checkbox", { name: /18 or older/ }).check();
        await qualifiedPage.getByRole("button", { name: "Email me a sign-in link" }).click();
        const qualifiedLink = await deliveredEmail(qualifiedPage, qualifiedEmail,
          origin, "/api/respondent/auth/callback");
        await qualifiedPage.goto(qualifiedLink.href);
        const accounts = await db.auth.admin.listUsers();
        expect(accounts.error).toBeNull();
        const qualifiedUser = accounts.data?.users.find((candidate) =>
          candidate.email === qualifiedEmail);
        if (!qualifiedUser) throw new Error("Synthetic qualified user absent");
        const qualifiedProfile = await db.from("respondents").select("id")
          .eq("auth_user_id", qualifiedUser.id).single();
        if (qualifiedProfile.error || !qualifiedProfile.data)
          throw new Error("Synthetic qualified profile absent");
        const qualifiedConsent = await db.from("consents").insert({
          respondent_id: qualifiedProfile.data.id, purpose: "retention",
          granted: true, text_version: "synthetic-screening-test",
        });
        expect(qualifiedConsent.error).toBeNull();
        const qualifiedOffer = await db.from("invites").insert({
          study_id: study.data.id, respondent_id: qualifiedProfile.data.id,
          state: "screening", reward_cents: 100,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        }).select("id").single();
        if (qualifiedOffer.error || !qualifiedOffer.data)
          throw new Error("Synthetic qualified offer absent");
        let submittedKey = "";
        await qualifiedPage.route(`**/api/respondent/screening/${qualifiedOffer.data.id}`,
          async (route) => {
            if (route.request().method() === "POST") {
              const posted = route.request().postDataJSON() as { key: string };
              submittedKey = posted.key;
            }
            await route.continue();
          });
        await qualifiedPage.goto("/r");
        await qualifiedPage.getByRole("link", { name: "Answer screening questions" }).click();
        await qualifiedPage.getByLabel("Your answer").fill(answerText);
        await qualifiedPage.getByRole("button", { name: "Submit answer" }).click();
        await expect(qualifiedPage.getByText("Your answer is awaiting review.")).toBeVisible();
        expect(submittedKey).toMatch(/^gate2-screen:[a-f0-9-]{36}$/);
        const submitted = { respondentId: qualifiedProfile.data.id,
          inviteId: qualifiedOffer.data.id, studyId: study.data.id,
          ruleId: rule.data.id, ruleVersion: 1, kind: "text" as const,
          text: answerText, transcriptionConsentVersion: null,
          idempotencyKey: submittedKey };
        let interpretations = 0;
        const reviewer = createScreeningAdapter(db as unknown as
          Parameters<typeof createScreeningAdapter>[0], {
          async interpret() {
            interpretations += 1;
            return { result: "supported", span: {
              startChar: 0, endChar: Array.from(answerText).length } };
          },
          async evidenceSupports(input) {
            return input.criterionText ===
              "Worked as a hospital nurse in the past 12 months" &&
              input.answerText === answerText && input.result === "supported" &&
              Array.from(input.answerText).slice(input.span.startChar,
                input.span.endChar).join("") === answerText;
          },
        });
        expect(await screenSubmittedAnswer(reviewer, submitted)).toBeNull();
        expect(interpretations).toBe(1);
        const invited = await db.from("invites").select("state")
          .eq("id", qualifiedOffer.data.id).single();
        expect(invited.error).toBeNull();
        expect(invited.data?.state).toBe("screening");
        const decisions = await db.from("gate2_screening_events").select("id")
          .eq("rule_id", rule.data.id);
        expect(decisions.error).toBeNull();
        expect(decisions.data).toEqual([]);
      } finally {
        await qualifiedContext.close();
      }
    } finally {
      await context.close();
    }
  });
});
