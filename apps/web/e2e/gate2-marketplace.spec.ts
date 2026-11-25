import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { prepareStudyCheckout, type CheckoutSession } from "@envoi-labs/services/checkout";
import { reconcilePaidStudyLaunch } from "@envoi-labs/services/paid-study";
import type { Database } from "../../../packages/db/src/database.generated";
import { createGate2CheckoutDatabase } from "../server/platform/gate2-checkout-db";
import { createGate2PaidStudyDatabase } from "../server/platform/gate2-paid-study-db";
import { deliveredEmail, localService, loopbackOrigin, totp, useDefaultTemplate } from
  "./support/disposable-auth";

const core = [
  "What made you look for a meal?", "What did you compare?",
  "What helped you decide?", "What was confusing?", "What would you change?",
];
const profile = [
  ["age_range", "25-34"], ["gender", "undisclosed"],
  ["student_year", "not_student"], ["lives_on_campus", false],
  ["online_shopping_frequency", "weekly"], ["region_zip", "02139"],
  ["food_orders_per_week", 2], ["interests", ["Food and drink"]],
] as const;

// The background-tab regression needs the real browser window visibility signal.
test.use({ headless: false });

test.describe("Gate 2 marketplace fixture replay", () => {
  test.skip(process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1", "Requires disposable local Auth and database.");
  test.skip(({ browserName }) => browserName !== "chromium", "Runs in the disposable Chromium Auth job.");

  test("AAL2 feasibility, frozen $2/$1 quote, synthetic paid launch and matched respondent offer", async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const origin = loopbackOrigin(baseURL);
    const db = localService();
    const typedDb = db as unknown as SupabaseClient<Database>;
    const researcherEmail = `gate2-market-researcher-${randomUUID()}@example.test`;
    const org = await db.from("organizations").insert({ name: "Synthetic open marketplace" }).select("id").single();
    if (org.error || !org.data) throw new Error(`Organization: ${org.error?.message}`);
    const account = await db.auth.admin.createUser({
      email: researcherEmail, email_confirm: !useDefaultTemplate,
    });
    if (account.error || !account.data.user) throw new Error(`Researcher: ${account.error?.message}`);
    const researcher = await db.from("researchers").insert({
      auth_user_id: account.data.user.id, organization_id: org.data.id,
      terms_version: "synthetic-test", terms_accepted_at: new Date().toISOString(),
    }).select("id").single();
    if (researcher.error || !researcher.data) throw new Error(`Membership: ${researcher.error?.message}`);

    const respondentEmails = Array.from({ length: 10 }, (_, index) =>
      `gate2-market-${index}-${randomUUID()}@example.test`);
    const users = await Promise.all(respondentEmails.map((email) =>
      db.auth.admin.createUser({ email, email_confirm: true })));
    const respondentIds = await Promise.all(users.map(async (created) => {
      if (created.error || !created.data.user) throw new Error(`Respondent: ${created.error?.message}`);
      const provisioned = await db.rpc("provision_email_respondent", {
        supplied_user_id: created.data.user.id,
      });
      if (provisioned.error || !provisioned.data) throw new Error(`Provisioning: ${provisioned.error?.message}`);
      return provisioned.data as string;
    }));
    const facts = await db.from("profile_attributes").insert(respondentIds.flatMap((respondent_id) =>
      profile.map(([key, value_json]) => ({ respondent_id, key, value_json, source: "signup" }))));
    expect(facts.error).toBeNull();
    const consents = await db.from("consents").insert(respondentIds.flatMap((respondent_id) =>
      ["retention", "researcher_access"].map((purpose) => ({
        respondent_id, purpose, granted: true, text_version: "synthetic-marketplace-fixture",
      }))));
    expect(consents.error).toBeNull();

    const study = await db.from("studies").insert({
      organization_id: org.data.id, title: "Synthetic meal decisions",
      state: "brief_ready", target_completes: 10, length_minutes: 10,
      deadline_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
    }).select("id").single();
    if (study.error || !study.data) throw new Error(`Study: ${study.error?.message}`);
    const brief = await db.from("brief_versions").insert({
      study_id: study.data.id, version: 1, brief_json: { purpose: "Synthetic fixture replay" },
      created_by: researcher.data.id,
    });
    expect(brief.error).toBeNull();
    const guide = await db.from("guide_questions").insert(core.map((text, index) => ({
      study_id: study.data.id, position: index + 1, text,
    })));
    expect(guide.error).toBeNull();

    const researcherContext = await browser.newContext({ baseURL: origin });
    try {
      const page = await researcherContext.newPage();
      await page.goto("/app/sign-in");
      await page.getByLabel("Email address").fill(researcherEmail);
      await page.getByRole("button", { name: "Send sign-in link" }).click();
      const link = await deliveredEmail(page, researcherEmail, origin, "/api/researcher/auth/callback");
      await page.goto(link.href);
      await expect(page).toHaveURL(/\/app\/mfa$/);
      await page.getByRole("button", { name: "Show setup key" }).click();
      const secret = (await page.locator("main code").textContent())?.trim();
      if (!secret) throw new Error("Disposable MFA setup key is missing.");
      await page.getByLabel("Authenticator code").fill(totp(secret, Date.now()));
      await page.getByRole("button", { name: "Verify and continue" }).click();
      await expect(page.getByRole("heading", { name: "New study" })).toBeVisible();
      const feasibilityResponse = await page.request.get(
        `/api/researcher/studies/${study.data.id}/feasibility`);
      expect(feasibilityResponse.status()).toBe(200);
      const feasibility = await feasibilityResponse.json();
      expect(feasibility).toMatchObject({ studyId: study.data.id,
        eligibleProfileCount: 10, basis: "insufficient_history", projectedCompletes: null });

      const quoteDb = createGate2CheckoutDatabase(typedDb, {
        id: researcher.data.id, organizationId: org.data.id,
        authUserId: account.data.user.id,
      });
      const approvedScope = await quoteDb.readApprovedScope(study.data.id);
      expect(approvedScope).toMatchObject({ studyId: study.data.id,
        coreQuestionCount: 5, targetRespondents: 10,
        feasibility: { eligibleProfileCount: 10 } });
      const selectedPricing = await quoteDb.readSelectedPricing(study.data.id);
      expect(selectedPricing).toMatchObject({ version: 101,
        unitPriceCents: 200, incentivePerQuestionCents: 100 });
      let providerSession: CheckoutSession | null = null;
      const provider = {
        async create(key: string, quote: { id: string; studyId: string;
          pricingConfigVersion: number; totalCents: number }) {
          expect(key).toBe(`gate2-checkout:${quote.id}`);
          providerSession = { id: `cs_test_fixture_${quote.id.replaceAll("-", "")}`,
            studyId: quote.studyId, quoteId: quote.id,
            pricingConfigVersion: quote.pricingConfigVersion,
            amountCents: quote.totalCents, currency: "usd" as const, status: "open" as const,
            url: "https://checkout.stripe.com/c/pay/synthetic-fixture" };
          return providerSession;
        },
        async get(id: string) {
          if (!providerSession || id !== providerSession.id) throw new Error("Unknown synthetic checkout");
          return providerSession;
        },
      };
      const prepared = await prepareStudyCheckout(quoteDb, provider, study.data.id);
      expect(prepared.status).toBe("ready");
      if (prepared.status !== "ready") throw new Error("Synthetic quote was not ready.");
      expect(prepared.quote).toMatchObject({ studyId: study.data.id, pricingConfigVersion: 101,
        totalCents: 10_000, incentiveCentsPerComplete: 500 });
      expect(prepared.quote.lineItems).toEqual([{
        label: "Core questions", coreQuestionCount: 5, respondentCount: 10,
        unitPriceCents: 200, amountCents: 10_000,
      }]);
      const repeat = await prepareStudyCheckout(quoteDb, provider, study.data.id);
      expect(repeat.status).toBe("ready");
      if (repeat.status === "ready") expect(repeat.quote.id).toBe(prepared.quote.id);
      const awaiting = await db.from("studies").update({ state: "awaiting_payment" })
        .eq("id", study.data.id);
      expect(awaiting.error).toBeNull();
      const launch = await reconcilePaidStudyLaunch(createGate2PaidStudyDatabase(typedDb), {
        async getCheckout(id) {
          expect(id).toBe(prepared.checkout.id);
          return { id, eventId: `synthetic-paid:${id}`, studyId: study.data.id,
            quoteId: prepared.quote.id, pricingConfigVersion: 101,
            amountCents: 10_000, currency: "usd", status: "paid", refundedCents: 0,
            observedAt: new Date().toISOString() };
        },
      }, study.data.id, prepared.quote.id);
      expect(launch).toBe("launched");
      const matched = await db.rpc("create_gate2_marketplace_offers", {
        supplied_study_id: study.data.id, supplied_quote_id: prepared.quote.id,
        supplied_auth_user_id: account.data.user.id, requested_count: 10,
      });
      expect(matched.error).toBeNull();
      expect(matched.data).toMatchObject({ created: 10, remaining: 0 });
      const offers = await db.from("invites").select("id,respondent_id,state,reward_cents")
        .eq("study_id", study.data.id);
      expect(offers.error).toBeNull();
      expect(offers.data).toHaveLength(10);
      const first = offers.data?.[0];
      if (!first) throw new Error("No synthetic matched offer was created.");
      expect(first).toMatchObject({ state: "invited", reward_cents: 500 });
      const respondentEmail = respondentEmails[respondentIds.indexOf(first.respondent_id)];
      if (!respondentEmail) throw new Error("Matched respondent email is missing.");
      const respondentContext = await browser.newContext({ baseURL: origin });
      try {
        const respondent = await respondentContext.newPage();
        await respondent.goto("/r/signup");
        await respondent.getByLabel("Email address").fill(respondentEmail);
        await respondent.getByRole("checkbox", { name: /18 or older/ }).check();
        await respondent.getByRole("button", { name: "Email me a sign-in link" }).click();
        const respondentLink = await deliveredEmail(respondent, respondentEmail, origin,
          "/api/respondent/auth/callback");
        await respondent.goto(respondentLink.href);
        await respondent.goto("/r");
        await expect(respondent.getByText("$5.00")).toBeVisible();
        await expect(respondent.getByRole("button", { name: "Start answering" })).toBeVisible();
        await respondent.goto("/r/earnings");
        await expect(respondent.getByText("No approved study rewards yet.")).toBeVisible();
        await respondent.goto("/r");
        await respondent.getByRole("button", { name: "Start answering" }).click();
        await expect(respondent).toHaveURL(origin + `/r/interviews/${first.id}`);
        for (const [index, question] of core.entries()) {
          await expect(respondent.getByRole("heading", { name: question })).toBeVisible();
          await respondent.getByRole("textbox", { name: "Type your answer" })
            .fill(`Synthetic answer ${index + 1} about a meal decision`);
          await respondent.getByRole("button", { name: "Save answer" }).click();
        }
        await expect(respondent.getByRole("heading", { name: "You’ve answered every question" })).toBeVisible();
        await respondent.getByRole("button", { name: "Submit interview" }).click();
        await expect(respondent.getByText("Pending quality check")).toBeVisible();
        const session = await db.from("sessions").select("id,state,submitted_at")
          .eq("invite_id", first.id).single();
        expect(session.error).toBeNull();
        expect(session.data?.state).toBe("quality_hold");
        if (!session.data) throw new Error("Submitted synthetic session was not found.");
        await respondent.goto("/r/earnings");
        await expect(respondent.getByText("No approved study rewards yet.")).toBeVisible();
        const reviewed = await db.rpc("decide_gate2_marketplace_quality", {
          supplied_study_id: study.data.id, supplied_quote_id: prepared.quote.id,
          supplied_session_id: session.data.id, supplied_actor_auth_id: account.data.user.id,
          supplied_decision: "approve", supplied_score: 100,
          supplied_components: { synthetic: true }, supplied_reason: null,
        });
        expect(reviewed.error).toBeNull();
        expect(reviewed.data).toMatchObject({ decision: "approve", sessionId: session.data.id });
        const replay = await db.rpc("decide_gate2_marketplace_quality", {
          supplied_study_id: study.data.id, supplied_quote_id: prepared.quote.id,
          supplied_session_id: session.data.id, supplied_actor_auth_id: account.data.user.id,
          supplied_decision: "approve", supplied_score: 100,
          supplied_components: { synthetic: true }, supplied_reason: null,
        });
        expect(replay.error).toBeNull();
        await respondent.reload();
        await expect(respondent.getByRole("heading", { name: "Earned" }).locator("..").getByText("$5.00"))
          .toBeVisible();
        await expect(respondent.getByRole("heading", { name: "Delivered" }).locator("..").getByText("$0.00"))
          .toBeVisible();
        await expect(respondent.getByText("Reward approved · payout not scheduled")).toBeVisible();
        const second = offers.data?.[1];
        const secondEmail = second && respondentEmails[respondentIds.indexOf(second.respondent_id)];
        const firstQuestion = core[0];
        if (!second || !secondEmail || !firstQuestion) throw new Error("Second synthetic offer is missing.");
        const secondContext = await browser.newContext({ baseURL: origin });
        try {
          const secondRespondent = await secondContext.newPage();
          await secondRespondent.goto("/r/signup");
          await secondRespondent.getByLabel("Email address").fill(secondEmail);
          await secondRespondent.getByRole("checkbox", { name: /18 or older/ }).check();
          await secondRespondent.getByRole("button", { name: "Email me a sign-in link" }).click();
          const secondLink = await deliveredEmail(secondRespondent, secondEmail, origin,
            "/api/respondent/auth/callback");
          await secondRespondent.goto(secondLink.href);
          const probeTurnId = randomUUID();
          const probeId = randomUUID();
          let answerCalls = 0;
          let sessionId = "";
          let questionId = "";
          let holdNextRead = false;
          let signalReadStarted: () => void = () => {};
          const readStarted = new Promise<void>((resolve) => { signalReadStarted = resolve; });
          let releaseRead: () => void = () => {};
          const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
          let signalReadFinished: () => void = () => {};
          const readFinished = new Promise<void>((resolve) => { signalReadFinished = resolve; });
          let releaseReceipt: () => void = () => {};
          const receiptGate = new Promise<void>((resolve) => { releaseReceipt = resolve; });
          let signalShown: () => void = () => {};
          const shownSeen = new Promise<void>((resolve) => { signalShown = resolve; });
          await secondRespondent.route("**/api/respondent/sessions/start", async (route) => {
            const response = await route.fetch();
            const held = holdNextRead;
            if (held) {
              signalReadStarted();
              await readGate;
              holdNextRead = false;
            }
            if (!response.ok()) {
              await route.fulfill({ response });
              if (held) signalReadFinished();
              return;
            }
            const current = await response.json() as {
              sessionId: string; nextQuestion: { id: string; text: string } | null;
            };
            sessionId = current.sessionId;
            questionId = current.nextQuestion?.id ?? "";
            await route.fulfill({ response, json: { ...current,
              currentProbe: answerCalls === 0 ? { turnId: probeTurnId, probeId,
                text: "What shaped your choice?" } : null } });
            if (held) signalReadFinished();
          });
          await secondRespondent.route("**/api/respondent/probes/shown", async (route) => {
            signalShown();
            await receiptGate;
            await route.fulfill({ status: 200, contentType: "application/json",
              body: JSON.stringify({ status: "recorded" }) });
          });
          await secondRespondent.route("**/api/respondent/probes/answer", async (route) => {
            answerCalls += 1;
            const posted = route.request().postDataJSON() as { answerId: string };
            const now = new Date().toISOString();
            await route.fulfill({ status: 200, contentType: "application/json",
              body: JSON.stringify({ answer: { id: posted.answerId, sessionId,
                guideQuestionId: questionId, kind: "text", probeId,
                durationMs: null, sequence: 1011, createdAt: now, updatedAt: now } }) });
          });
          await secondRespondent.goto("/r");
          await secondRespondent.getByRole("button", { name: "Start answering" }).click();
          await expect(secondRespondent).toHaveURL(origin + `/r/interviews/${second.id}`);
          await expect(secondRespondent.getByRole("heading", { name: "What shaped your choice?" }))
            .toBeVisible();
          await shownSeen;
          await expect(secondRespondent.getByRole("button", { name: "Save answer" })).toBeDisabled();
          await expect(secondRespondent.getByLabel("Type your answer")).toBeDisabled();
          expect(answerCalls).toBe(0);
          releaseReceipt();
          await expect(secondRespondent.getByRole("button", { name: "Save answer" })).toBeEnabled();
          await secondRespondent.getByLabel("Type your answer").fill("A shorter wait mattered.");
          await secondRespondent.getByRole("button", { name: "Save answer" }).click();
          await expect(secondRespondent.getByRole("heading", { name: firstQuestion })).toBeVisible();
          expect(answerCalls).toBe(1);
          holdNextRead = true;
          await secondRespondent.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
          await readStarted;
          // Playwright emulates focus on every page; remove that override so
          // Chromium can report the real tab-strip visibility transition.
          const focusSession = await secondContext.newCDPSession(secondRespondent);
          await focusSession.send("Emulation.setFocusEmulationEnabled", { enabled: false });
          const background = await secondContext.newPage();
          await background.goto("about:blank");
          await background.bringToFront();
          await expect.poll(() => secondRespondent.evaluate(() => document.visibilityState))
            .toBe("hidden");
          await expect(secondRespondent.getByRole("heading", { name: firstQuestion })).toHaveCount(0);
          releaseRead();
          await readFinished;
          await expect(secondRespondent.getByRole("heading", { name: firstQuestion })).toHaveCount(0);
          const withdrawn = await db.from("consents").insert({
            respondent_id: second.respondent_id, purpose: "retention", granted: false,
            text_version: "synthetic-marketplace-withdrawal",
          });
          expect(withdrawn.error).toBeNull();
          await secondRespondent.bringToFront();
          await expect.poll(() => secondRespondent.evaluate(() => document.visibilityState))
            .toBe("visible");
          await expect(secondRespondent.getByRole("heading", { name: firstQuestion })).toHaveCount(0);
          await expect(secondRespondent.getByRole("textbox", { name: "Type your answer" })).toHaveCount(0);
          await expect(secondRespondent.getByRole("alert")).toBeVisible();
          await background.close();
          await focusSession.detach();
        } finally {
          await secondContext.close();
        }
      } finally {
        await respondentContext.close();
      }
    } finally {
      await researcherContext.close();
    }
  });
});
