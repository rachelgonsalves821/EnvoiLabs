import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { prepareStudyCheckout, type CheckoutSession } from "@envoi-labs/services/checkout";
import { reconcilePaidStudyLaunch } from "@envoi-labs/services/paid-study";
import type { Database } from "../../../packages/db/src/database.generated";
import { createGate2CheckoutDatabase } from "../server/platform/gate2-checkout-db";
import { createGate2PaidStudyDatabase } from "../server/platform/gate2-paid-study-db";
import { issueGate2SandboxVisaBatch } from "../server/platform/gate2-visa-batch-issue";
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

test.describe("Gate 2 marketplace fixture replay", () => {
  test.skip(process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1", "Requires disposable local Auth and database.");
  test.skip(({ browserName }) => browserName !== "chromium", "Runs in the disposable Chromium Auth job.");

  test("AAL2 feasibility, frozen $2/$1 quote, synthetic paid launch and matched respondent offer", async ({ browser, baseURL }) => {
    test.setTimeout(process.env.ENVOI_GATE5_FULL_WALKTHROUGH === "1" ? 1_200_000 : 360_000);
    const origin = loopbackOrigin(baseURL);
    const db = localService();
    const typedDb = db as unknown as SupabaseClient<Database>;
    const researcherEmail = `gate2-market-researcher-${randomUUID()}@example.test`;
    const fullWalkthrough = process.env.ENVOI_GATE5_FULL_WALKTHROUGH === "1";
    const org = fullWalkthrough
      ? await db.from("organizations").select("id")
        .eq("id", "90100000-0000-4000-8000-000000000001").single()
      : await db.from("organizations").insert({ name: "Synthetic open marketplace" })
        .select("id").single();
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
    let respondentIds: string[];
    if (fullWalkthrough) {
      respondentIds = [];
      for (const email of respondentEmails) {
        const context = await browser.newContext({ baseURL: origin });
        try {
          const profilePage = await context.newPage();
          await profilePage.goto("/r/signup");
          await profilePage.getByLabel("Email address").fill(email);
          await profilePage.getByRole("checkbox", { name: /18 or older/ }).check();
          await profilePage.getByRole("button", { name: "Email me a sign-in link" }).click();
          await expect.poll(async () => (await context.cookies(origin +
            "/api/respondent/auth/callback"))
            .some(({ name }) => name === "envoi-respondent-age")).toBe(true);
          const link = await deliveredEmail(profilePage, email, origin,
            "/api/respondent/auth/callback");
          await profilePage.goto(link.href);
          await expect(profilePage).toHaveURL(origin + "/r/status");
          await profilePage.getByRole("link", { name: "Profile and privacy choices" }).click();
          await profilePage.getByLabel("What’s your age range?").selectOption("25-34");
          await profilePage.getByLabel("How do you describe your gender?")
            .selectOption("undisclosed");
          await profilePage.getByLabel("Are you currently in school?")
            .selectOption("not_student");
          await profilePage.getByLabel("Do you live on campus?").selectOption("false");
          await profilePage.getByLabel("How often do you shop online?")
            .selectOption("weekly");
          await profilePage.getByLabel("What’s your ZIP code?").fill("02139");
          await profilePage.getByLabel("How many times do you order food in a typical week?")
            .fill("2");
          await profilePage.getByRole("checkbox", { name: "Food and drink" }).check();
          await profilePage.getByRole("checkbox", { name: "Technology" }).check();
          await profilePage.getByRole("button", { name: "Save and continue" }).click();
          await expect(profilePage.getByRole("heading", { name: "Choose what to share" }))
            .toBeVisible();
          await profilePage.getByRole("checkbox", { name: /Keep my study answers/ }).check();
          await profilePage.getByRole("checkbox",
            { name: /Share my redacted answers with researchers/ }).check();
          await profilePage.getByRole("button", { name: "Save privacy choices" }).click();
          await expect(profilePage.getByRole("heading", { name: "Your account is ready" }))
            .toBeVisible();
          const listed = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
          const user = listed.data?.users.find((item) => item.email === email);
          if (listed.error || !user) throw new Error("Open fictional signup user missing.");
          const respondent = await db.from("respondents").select("id")
            .eq("auth_user_id", user.id).single();
          if (respondent.error || !respondent.data)
            throw new Error("Open fictional signup profile missing.");
          respondentIds.push(respondent.data.id);
        } finally { await context.close(); }
      }
      expect(new Set(respondentIds).size).toBe(10);
    } else {
      const users = await Promise.all(respondentEmails.map((email) =>
        db.auth.admin.createUser({ email, email_confirm: true })));
      respondentIds = await Promise.all(users.map(async (created) => {
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
    }

    const study = await db.from("studies").insert({
      organization_id: org.data.id, title: "Synthetic meal decisions",
      state: "brief_ready", target_completes: 10, length_minutes: 10,
      deadline_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
    }).select("id").single();
    if (study.error || !study.data) throw new Error(`Study: ${study.error?.message}`);
    const brief = await db.from("brief_versions").insert({
      study_id: study.data.id, version: 1, brief_json: {
        purpose: "Synthetic fixture replay",
        hypotheses: ["A clear meal choice reduces hesitation."],
      },
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
      await page.goto(`/app/studies/${study.data.id}`);
      await page.setViewportSize({ width: 320, height: 740 });
      await page.reload();
      await expect(page.getByRole("region", { name: "Study tracking" })
        .getByTestId("gate5-simulated-payment-inline")).toContainText("No card charged");
      await page.setViewportSize({ width: 1280, height: 720 });
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
        await expect.poll(async () => (await respondentContext.cookies(origin +
          "/api/respondent/auth/callback"))
          .some(({ name }) => name === "envoi-respondent-age")).toBe(true);
        const respondentLink = await deliveredEmail(respondent, respondentEmail, origin,
          "/api/respondent/auth/callback");
        await respondent.goto(respondentLink.href);
        await expect(respondent).toHaveURL(origin + "/r/status");
        await respondent.goto("/r");
        await expect(respondent.getByText("$5.00")).toBeVisible();
        await expect(respondent.getByRole("button", { name: "Start answering" })).toBeVisible();
        await respondent.goto("/r/earnings");
        await expect(respondent.getByText("No approved study rewards yet.")).toBeVisible();
        await respondent.goto("/r");
        await respondent.getByRole("button", { name: "Start answering" }).click();
        await expect(respondent).toHaveURL(origin + `/r/interviews/${first.id}`);
        if (process.env.ENVOI_GATE5_MOBILE_TRACE === "1") {
          const mobileFirstQuestion = core[0];
          if (!mobileFirstQuestion) throw new Error("Fictional first question is missing.");
          const cdp = await respondentContext.newCDPSession(respondent);
          try {
            await respondent.setViewportSize({ width: 360, height: 780 });
            await cdp.send("Network.enable");
            await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
            await cdp.send("Network.emulateNetworkConditions", {
              offline: false, latency: 150,
              downloadThroughput: 1_600_000 / 8,
              uploadThroughput: 750_000 / 8,
            });
            await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
            await respondent.addInitScript(() => {
              const measure = window as unknown as { __gate5LcpMs?: number };
              new PerformanceObserver((entries) => {
                for (const entry of entries.getEntries())
                  measure.__gate5LcpMs = entry.startTime;
              }).observe({ type: "largest-contentful-paint", buffered: true });
            });
            const openedAt = Date.now();
            await respondent.goto(`/r/interviews/${first.id}`);
            await expect(respondent.getByRole("heading", { name: mobileFirstQuestion })).toBeVisible();
            const firstQuestionMs = Date.now() - openedAt;
            await respondent.waitForTimeout(1200);
            const browser = await respondent.evaluate(() => {
              const measure = window as unknown as { __gate5LcpMs?: number };
              const scripts = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
                .filter((entry) => new URL(entry.name).pathname.endsWith(".js"))
                .map((entry) => ({
                  path: new URL(entry.name).pathname,
                  transferBytes: entry.transferSize,
                  encodedBytes: entry.encodedBodySize,
                }));
              return { lcpMs: measure.__gate5LcpMs ?? null, scripts };
            });
            expect(browser.lcpMs).toBeGreaterThan(0);
            expect(browser.scripts.length).toBeGreaterThan(0);
            const revision = execFileSync("git", ["rev-parse", "HEAD"],
              { encoding: "utf8" }).trim();
            const buildId = (await readFile("apps/web/.next/BUILD_ID", "utf8")).trim();
            await writeFile("apps/web/.next/gate5-mobile-diagnostic.json", JSON.stringify({
              revision, buildId, profile: "360px Chromium, 4x CPU, 150ms, 1.6Mbps down",
              runs: 1, lcpMs: browser.lcpMs, firstQuestionMs,
              requestedJsTransferBytes: browser.scripts.reduce(
                (sum, item) => sum + item.transferBytes, 0),
              scripts: browser.scripts,
            }, null, 2));
          } finally {
            await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
            await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
            await cdp.send("Network.emulateNetworkConditions", {
              offline: false, latency: 0, downloadThroughput: -1,
              uploadThroughput: -1,
            });
            await cdp.detach();
            await respondent.setViewportSize({ width: 1280, height: 720 });
          }
        }
        for (const [index, question] of core.entries()) {
          await expect(respondent.getByRole("heading", { name: question })).toBeVisible();
          await respondent.getByRole("textbox", { name: "Type your answer" })
            .fill(index === 0 ? "Synthetic 😀 answer 1 about a meal decision"
              : `Synthetic answer ${index + 1} about a meal decision`);
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
        // IT-2.1 requires three distinct completes in the same paid study.
        // Keep the second offer untouched for the probe race below.
        for (const additional of offers.data?.slice(2, 4) ?? []) {
          const additionalEmail = respondentEmails[
            respondentIds.indexOf(additional.respondent_id)];
          if (!additionalEmail) throw new Error("Additional matched email is missing.");
          const additionalContext = await browser.newContext({ baseURL: origin });
          try {
            const additionalPage = await additionalContext.newPage();
            await additionalPage.goto("/r/signup");
            await additionalPage.getByLabel("Email address").fill(additionalEmail);
            await additionalPage.getByRole("checkbox", { name: /18 or older/ }).check();
            await additionalPage.getByRole("button", { name: "Email me a sign-in link" }).click();
            await expect.poll(async () => (await additionalContext.cookies(origin +
              "/api/respondent/auth/callback"))
              .some(({ name }) => name === "envoi-respondent-age")).toBe(true);
            const additionalLink = await deliveredEmail(additionalPage,
              additionalEmail, origin, "/api/respondent/auth/callback");
            await additionalPage.goto(additionalLink.href);
            await expect(additionalPage).toHaveURL(origin + "/r/status");
            await additionalPage.goto("/r");
            await additionalPage.getByRole("button", { name: "Start answering" }).click();
            await expect(additionalPage).toHaveURL(
              origin + `/r/interviews/${additional.id}`);
            for (const [index, question] of core.entries()) {
              await expect(additionalPage.getByRole("heading", { name: question }))
                .toBeVisible();
              await additionalPage.getByRole("textbox", { name: "Type your answer" })
                .fill(`Synthetic same-study answer ${index + 1}`);
              await additionalPage.getByRole("button", { name: "Save answer" }).click();
            }
            await additionalPage.getByRole("button", { name: "Submit interview" }).click();
            await expect(additionalPage.getByText("Pending quality check")).toBeVisible();
            const additionalSession = await db.from("sessions")
              .select("id,state,submitted_at").eq("invite_id", additional.id).single();
            if (additionalSession.error || !additionalSession.data)
              throw new Error("Additional submitted session is missing.");
            expect(additionalSession.data.state).toBe("quality_hold");
            expect(additionalSession.data.submitted_at).not.toBeNull();
            const additionalReview = await db.rpc("decide_gate2_marketplace_quality", {
              supplied_study_id: study.data.id,
              supplied_quote_id: prepared.quote.id,
              supplied_session_id: additionalSession.data.id,
              supplied_actor_auth_id: account.data.user.id,
              supplied_decision: "approve", supplied_score: 100,
              supplied_components: { synthetic: true }, supplied_reason: null,
            });
            expect(additionalReview.error).toBeNull();
            await additionalPage.goto("/r/earnings");
            await expect(additionalPage.getByRole("heading", { name: "Earned" })
              .locator("..").getByText("$5.00")).toBeVisible();
          } finally {
            await additionalContext.close();
          }
        }
        const firstStudyApprovals = await db.from("sessions")
          .select("id", { count: "exact", head: true })
          .eq("study_id", study.data.id).eq("state", "approved");
        expect(firstStudyApprovals.error).toBeNull();
        expect(firstStudyApprovals.count).toBe(3);
        // IT-2.4: a reviewed removal frees one purchased slot and creates a
        // new offer for a newly eligible profile under the original quote.
        const standbyEmail = `gate2-market-standby-${randomUUID()}@example.test`;
        const standbyUser = await db.auth.admin.createUser({
          email: standbyEmail, email_confirm: true,
        });
        if (standbyUser.error || !standbyUser.data.user)
          throw new Error("Synthetic standby account is missing.");
        const standby = await db.rpc("provision_email_respondent", {
          supplied_user_id: standbyUser.data.user.id,
        });
        if (standby.error || !standby.data)
          throw new Error("Synthetic standby profile is missing.");
        const standbyFacts = await db.from("profile_attributes").insert(
          profile.map(([key, value_json]) => ({ respondent_id: standby.data,
            key, value_json, source: "signup" })));
        expect(standbyFacts.error).toBeNull();
        const standbyConsents = await db.from("consents").insert(
          ["retention", "researcher_access"].map((purpose) => ({
            respondent_id: standby.data, purpose, granted: true,
            text_version: "synthetic-marketplace-fixture",
          })));
        expect(standbyConsents.error).toBeNull();

        const submitOffer = async (email: string, offerId: string) => {
          const context = await browser.newContext({ baseURL: origin });
          try {
            const page = await context.newPage();
            await page.goto("/r/signup");
            await page.getByLabel("Email address").fill(email);
            await page.getByRole("checkbox", { name: /18 or older/ }).check();
            await page.getByRole("button", { name: "Email me a sign-in link" }).click();
            await expect.poll(async () => (await context.cookies(origin +
              "/api/respondent/auth/callback"))
              .some(({ name }) => name === "envoi-respondent-age"),
            { message: "Fictional signup must commit its age proof before callback" })
              .toBe(true);
            const link = await deliveredEmail(page, email, origin,
              "/api/respondent/auth/callback");
            await page.goto(link.href);
            await expect(page).toHaveURL(origin + "/r/status");
            await page.goto("/r");
            await page.getByRole("button", { name: "Start answering" }).click();
            await expect(page).toHaveURL(origin + `/r/interviews/${offerId}`);
            for (const [index, question] of core.entries()) {
              await expect(page.getByRole("heading", { name: question })).toBeVisible();
              await page.getByRole("textbox", { name: "Type your answer" })
                .fill(`Synthetic replacement answer ${index + 1}`);
              await page.getByRole("button", { name: "Save answer" }).click();
            }
            await page.getByRole("button", { name: "Submit interview" }).click();
            await expect(page.getByText("Pending quality check")).toBeVisible();
            const submitted = await db.from("sessions").select("id,state")
              .eq("invite_id", offerId).single();
            if (submitted.error || !submitted.data || submitted.data.state !== "quality_hold")
              throw new Error("Synthetic replacement journey did not reach quality hold.");
            return { context, page, sessionId: submitted.data.id };
          } catch (error) {
            await context.close();
            throw error;
          }
        };
        const removable = offers.data?.[4];
        if (!removable) throw new Error("The removable synthetic offer is missing.");
        const removableEmail = respondentEmails[
          respondentIds.indexOf(removable.respondent_id)];
        if (!removableEmail) throw new Error("The removable account email is missing.");
        const removedJourney = await submitOffer(removableEmail, removable.id);
        try {
          const removalArgs = {
            supplied_study_id: study.data.id, supplied_quote_id: prepared.quote.id,
            supplied_session_id: removedJourney.sessionId,
            supplied_actor_auth_id: account.data.user.id,
            supplied_decision: "remove", supplied_score: 0,
            supplied_components: { synthetic: true },
            supplied_reason: "Synthetic reviewed removal",
          };
          const removal = await db.rpc("decide_gate2_marketplace_quality", removalArgs);
          expect(removal.error).toBeNull();
          expect(removal.data).toMatchObject({ decision: "remove",
            replacement: { created: 1, remaining: 0 } });
          const replayRemoval = await db.rpc("decide_gate2_marketplace_quality", removalArgs);
          expect(replayRemoval.error).toBeNull();
          expect(replayRemoval.data).toMatchObject({ replacement: { created: 0 } });
          await removedJourney.page.goto("/r/earnings");
          await expect(removedJourney.page.getByText("No approved study rewards yet."))
            .toBeVisible();
        } finally {
          await removedJourney.context.close();
        }
        const replacementOffer = await db.from("invites")
          .select("id,state,reward_cents").eq("study_id", study.data.id)
          .eq("respondent_id", standby.data).single();
        if (replacementOffer.error || !replacementOffer.data)
          throw new Error("The purchased slot did not produce a standby offer.");
        expect(replacementOffer.data).toMatchObject({ state: "invited", reward_cents: 500 });
        const replacementJourney = await submitOffer(standbyEmail, replacementOffer.data.id);
        try {
          const approval = await db.rpc("decide_gate2_marketplace_quality", {
            supplied_study_id: study.data.id, supplied_quote_id: prepared.quote.id,
            supplied_session_id: replacementJourney.sessionId,
            supplied_actor_auth_id: account.data.user.id,
            supplied_decision: "approve", supplied_score: 100,
            supplied_components: { synthetic: true }, supplied_reason: null,
          });
          expect(approval.error).toBeNull();
          await replacementJourney.page.goto("/r/earnings");
          await expect(replacementJourney.page.getByRole("heading", { name: "Earned" })
            .locator("..").getByText("$5.00")).toBeVisible();
        } finally {
          await replacementJourney.context.close();
        }
        const afterReplacement = await db.from("sessions")
          .select("id,state").eq("study_id", study.data.id)
          .in("state", ["approved", "removed"]);
        expect(afterReplacement.error).toBeNull();
        expect(afterReplacement.data?.filter(({ state }) => state === "approved")).toHaveLength(4);
        expect(afterReplacement.data?.filter(({ state }) => state === "removed")).toHaveLength(1);
        const offerCount = await db.from("invites")
          .select("id", { count: "exact", head: true }).eq("study_id", study.data.id);
        expect(offerCount.count).toBe(11);
        const frozenQuotes = await db.from("gate2_quote_snapshots")
          .select("id,total_cents").eq("study_id", study.data.id);
        expect(frozenQuotes.data).toEqual([{ id: prepared.quote.id, total_cents: 10_000 }]);
        // Two more paid studies earn the same respondent enough for one
        // denomination-qualified synthetic Visa batch. They remain separate
        // quotes and approved session receipts.
        for (let number = 2; number <= 3; number += 1) {
          // Prior matched offers remain active for the separate probe race
          // below. Add ten new eligible profiles so feasibility does not rely
          // on the returning respondent being counted at quote time.
          const extraProfiles = await Promise.all(Array.from({ length: 10 }, async () => {
            const created = await db.auth.admin.createUser({
              email: `gate2-market-extra-${number}-${randomUUID()}@example.test`,
              email_confirm: true,
            });
            if (created.error || !created.data.user) throw new Error("Extra profile account absent");
            const provisioned = await db.rpc("provision_email_respondent", {
              supplied_user_id: created.data.user.id,
            });
            if (provisioned.error || !provisioned.data) throw new Error("Extra profile absent");
            return provisioned.data as string;
          }));
          const extraFacts = await db.from("profile_attributes").insert(
            extraProfiles.flatMap((respondent_id) =>
              profile.map(([key, value_json]) => ({ respondent_id, key,
                value_json: key === "region_zip" ? "02138" : value_json,
                source: "signup" }))));
          expect(extraFacts.error).toBeNull();
          const extraConsents = await db.from("consents").insert(
            extraProfiles.flatMap((respondent_id) =>
              ["retention", "researcher_access"].map((purpose) => ({
                respondent_id, purpose, granted: true,
                text_version: "synthetic-marketplace-fixture",
              }))));
          expect(extraConsents.error).toBeNull();
          const extra = await db.from("studies").insert({
            organization_id: org.data.id,
            title: `Synthetic meal decisions ${number}`,
            state: "brief_ready", target_completes: 10, length_minutes: 10,
            deadline_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
          }).select("id").single();
          if (extra.error || !extra.data) throw new Error(`Extra study: ${extra.error?.message}`);
          const preference = await db.from("criteria").insert({
            study_id: extra.data.id, kind: "nice", attribute_key: "region_zip",
            operator: "eq", value_json: "02139",
            text: "Returning synthetic respondent preference",
          });
          expect(preference.error).toBeNull();
          const extraBrief = await db.from("brief_versions").insert({
            study_id: extra.data.id, version: 1,
            brief_json: { purpose: "Synthetic paid Visa fixture" },
            created_by: researcher.data.id,
          });
          expect(extraBrief.error).toBeNull();
          const extraGuide = await db.from("guide_questions").insert(core.map((text, index) => ({
            study_id: extra.data.id, position: index + 1, text,
          })));
          expect(extraGuide.error).toBeNull();
          const extraDb = createGate2CheckoutDatabase(typedDb, {
            id: researcher.data.id, organizationId: org.data.id,
            authUserId: account.data.user.id,
          });
          const extraScope = await extraDb.readApprovedScope(extra.data.id);
          expect(extraScope?.feasibility.eligibleProfileCount).toBeGreaterThanOrEqual(10);
          let extraSession: CheckoutSession | null = null;
          const checkout = await prepareStudyCheckout(extraDb, {
            async create(_key, quote) {
              extraSession = { id: `cs_test_fixture_${quote.id.replaceAll("-", "")}`,
                studyId: quote.studyId, quoteId: quote.id,
                pricingConfigVersion: quote.pricingConfigVersion,
                amountCents: quote.totalCents, currency: "usd", status: "open",
                url: "https://checkout.stripe.com/c/pay/synthetic-fixture" };
              return extraSession;
            },
            async get(id) {
              if (!extraSession || id !== extraSession.id) throw new Error("Unknown checkout");
              return extraSession;
            },
          }, extra.data.id);
          expect(checkout.status).toBe("ready");
          if (checkout.status !== "ready") throw new Error("Extra checkout unavailable");
          expect(checkout.quote.totalCents).toBe(10_000);
          const extraAwaiting = await db.from("studies")
            .update({ state: "awaiting_payment" }).eq("id", extra.data.id);
          expect(extraAwaiting.error).toBeNull();
          expect(await reconcilePaidStudyLaunch(createGate2PaidStudyDatabase(typedDb), {
            async getCheckout(id) {
              return { id, eventId: `synthetic-paid:${id}`,
                studyId: extra.data.id, quoteId: checkout.quote.id,
                pricingConfigVersion: 101, amountCents: 10_000,
                currency: "usd", status: "paid", refundedCents: 0,
                observedAt: new Date().toISOString() };
            },
          }, extra.data.id, checkout.quote.id)).toBe("launched");
          const wave = await db.rpc("create_gate2_marketplace_offers", {
            supplied_study_id: extra.data.id,
            supplied_quote_id: checkout.quote.id,
            supplied_auth_user_id: account.data.user.id, requested_count: 10,
          });
          expect(wave.error).toBeNull();
          const extraOffer = await db.from("invites").select("id")
            .eq("study_id", extra.data.id).eq("respondent_id", first.respondent_id).single();
          if (extraOffer.error || !extraOffer.data) throw new Error(`Extra offer: ${extraOffer.error?.message}`);
          await respondent.goto("/r");
          await respondent.getByRole("button", { name: "Start answering" }).click();
          await expect(respondent).toHaveURL(
            origin + `/r/interviews/${extraOffer.data.id}`);
          for (const [index, question] of core.entries()) {
            await expect(respondent.getByRole("heading", { name: question })).toBeVisible();
            await respondent.getByRole("textbox", { name: "Type your answer" })
              .fill(`Synthetic study ${number}, answer ${index + 1}`);
            await respondent.getByRole("button", { name: "Save answer" }).click();
          }
          await respondent.getByRole("button", { name: "Submit interview" }).click();
          await expect(respondent.getByText("Pending quality check")).toBeVisible();
          const extraInterview = await db.from("sessions").select("id,state,submitted_at")
            .eq("invite_id", extraOffer.data.id).single();
          if (extraInterview.error || !extraInterview.data) throw new Error("Extra session absent");
          expect(extraInterview.data.state).toBe("quality_hold");
          expect(extraInterview.data.submitted_at).not.toBeNull();
          const decision = await db.rpc("decide_gate2_marketplace_quality", {
            supplied_study_id: extra.data.id,
            supplied_quote_id: checkout.quote.id,
            supplied_session_id: extraInterview.data.id,
            supplied_actor_auth_id: account.data.user.id,
            supplied_decision: "approve", supplied_score: 100,
            supplied_components: { synthetic: true }, supplied_reason: null,
          });
          expect(decision.error).toBeNull();
        }
        const seeded = await db.rpc("prepare_gate2_visa_e2e_fixture", {
          requested_respondent_id: first.respondent_id,
        });
        expect(seeded.error).toBeNull();
        expect(seeded.data).toBe(true);
        const orderId = `ORDER-BROWSER-${randomUUID()}`;
        let payoutKey = "";
        let created = false;
        let orderPosts = 0;
        const request: typeof fetch = async (input, init) => {
          const url = String(input);
          const json = (body: unknown, status = 200) =>
            new Response(JSON.stringify(body), { status,
              headers: { "content-type": "application/json" } });
          if (url.includes("/products?")) return json({ products: [{
            id: "sandbox_visa", category: "visa_card", currency_codes: ["USD"],
            countries: [{ abbr: "US" }],
            skus: [{ min: 10, max: 500, currency_code: "USD" }],
          }] });
          if (init?.method === "POST") {
            orderPosts += 1;
            const body = JSON.parse(String(init.body)) as { external_id: string };
            payoutKey = body.external_id;
            created = true;
          }
          if (url.includes("/orders")) {
            if (!created) return json({}, 404);
            const order = { id: orderId, external_id: payoutKey,
              created_at: new Date().toISOString(), status: "EXECUTED",
              rewards: [{ products: ["sandbox_visa"],
                value: { denomination: 15, currency_code: "USD" },
                recipient: { name: "Synthetic Browser Person", email: respondentEmail },
                delivery: { method: "EMAIL", status: "SUCCEEDED" } }] };
            return json({ order });
          }
          throw new Error(`Unexpected synthetic provider URL: ${url}`);
        };
        const batchRequestId = randomUUID();
        const batchInput = { client: typedDb, apiKey: "TEST_browser_fixture",
          respondentId: first.respondent_id, requestId: batchRequestId,
          annualCapCents: 200_000, request };
        expect(await issueGate2SandboxVisaBatch(batchInput)).toBe("delivered");
        expect(await issueGate2SandboxVisaBatch(batchInput)).toBe("delivered");
        expect(orderPosts).toBe(1);
        await respondent.goto("/r/earnings");
        await respondent.setViewportSize({ width: 320, height: 740 });
        await respondent.reload();
        await expect(respondent.getByRole("heading", { name: "Delivered" })
          .locator("..").getByTestId("gate5-mocked-payout-inline"))
          .toContainText("No Visa sent");
        const receiptRows = respondent.locator(".respondent-earnings-list li");
        await expect(receiptRows).toHaveCount(3);
        for (const row of await receiptRows.all()) {
          await expect(row.getByTestId("gate5-mocked-payout-inline"))
            .toContainText("receipt is synthetic");
        }
        await respondent.setViewportSize({ width: 1280, height: 720 });
        await expect(respondent.getByRole("heading", { name: "Earned" })
          .locator("..").getByText("$15.00")).toBeVisible();
        await expect(respondent.getByRole("heading", { name: "Delivered" })
          .locator("..").getByText("$15.00")).toBeVisible();
        await expect(respondent.locator(".respondent-earnings-list small:not([data-testid])"))
          .toHaveCount(3);
        const receipts = await respondent.locator(".respondent-earnings-list small:not([data-testid])")
          .allTextContents();
        expect(new Set(receipts)).toHaveProperty("size", 1);
        if (fullWalkthrough) {
          const remaining = [offers.data?.[1], ...(offers.data?.slice(5) ?? [])];
          expect(remaining).toHaveLength(6);
          for (const offer of remaining) {
            if (!offer) throw new Error("A purchased slot has no fictional offer.");
            const email = respondentEmails[respondentIds.indexOf(offer.respondent_id)];
            if (!email) throw new Error("A matched fictional email is missing.");
            const journey = await submitOffer(email, offer.id);
            try {
              const approved = await db.rpc("decide_gate2_marketplace_quality", {
                supplied_study_id: study.data.id, supplied_quote_id: prepared.quote.id,
                supplied_session_id: journey.sessionId,
                supplied_actor_auth_id: account.data.user.id,
                supplied_decision: "approve", supplied_score: 100,
                supplied_components: { synthetic: true }, supplied_reason: null,
              });
              expect(approved.error).toBeNull();
            } finally { await journey.context.close(); }
          }
          const completed = await db.from("sessions").select("id,state")
            .eq("study_id", study.data.id).in("state", ["approved", "removed"]);
          expect(completed.error).toBeNull();
          expect(completed.data?.filter(({ state }) => state === "approved")).toHaveLength(10);
          expect(completed.data?.filter(({ state }) => state === "removed")).toHaveLength(1);
          const quoteStillFrozen = await db.from("gate2_quote_snapshots")
            .select("id,total_cents").eq("study_id", study.data.id);
          expect(quoteStillFrozen.data).toEqual([{ id: prepared.quote.id, total_cents: 10_000 }]);

          const ownReferral = await respondent.request.get("/api/respondent/referral");
          expect(ownReferral.status()).toBe(200);
          const { code } = await ownReferral.json() as { code: string };
          for (let index = 0; index < 5; index += 1) {
            const email = `gate5-referee-${index}-${randomUUID()}@example.test`;
            const created = await db.auth.admin.createUser({ email, email_confirm: true });
            if (created.error || !created.data.user) throw new Error("Fictional referee missing.");
            const provisioned = await db.rpc("provision_email_respondent", {
              supplied_user_id: created.data.user.id,
            });
            if (provisioned.error || !provisioned.data) throw new Error("Fictional referee profile missing.");
            const facts = await db.from("profile_attributes").insert(profile.map(([key, value_json]) =>
              ({ respondent_id: provisioned.data, key, value_json, source: "signup" })));
            expect(facts.error).toBeNull();
            const refereeContext = await browser.newContext({ baseURL: origin });
            try {
              const referee = await refereeContext.newPage();
              await referee.goto("/r/signup");
              await referee.getByLabel("Email address").fill(email);
              await referee.getByRole("checkbox", { name: /18 or older/ }).check();
              await referee.getByRole("button", { name: "Email me a sign-in link" }).click();
              await expect.poll(async () => (await refereeContext.cookies(origin +
                "/api/respondent/auth/callback"))
                .some(({ name }) => name === "envoi-respondent-age")).toBe(true);
              const link = await deliveredEmail(referee, email, origin,
                "/api/respondent/auth/callback");
              await referee.goto(link.href);
              await expect(referee).toHaveURL(origin + "/r/status");
              await referee.goto("/r");
              const referralSelf = await referee.request.get("/api/respondent/referral");
              expect(referralSelf.status()).toBe(200);
              const registered = await referee.request.post("/api/respondent/referral", {
                headers: { origin },
                data: { code },
              });
              expect(registered.status()).toBe(200);
              expect(await registered.json()).toMatchObject({ attributed: true, profileVerified: true });
            } finally { await refereeContext.close(); }
          }
          const vested = await db.from("gate2_referral_vestings")
            .select("bonus_cents,verified_profile_count")
            .eq("referrer_id", first.respondent_id).single();
          expect(vested.error).toBeNull();
          expect(vested.data).toMatchObject({ bonus_cents: 500, verified_profile_count: 5 });
          await respondent.reload();
          await expect(respondent.getByText("5 verified profiles")).toBeVisible();
          await expect(respondent.getByText("$5.00 referral bonus vested")).toBeVisible();
          const referral = respondent.locator(".respondent-earnings-referral");
          await expect(referral).not.toContainText("Delivered");
          await expect(referral).not.toContainText("Receipt");
          await expect(referral).not.toContainText("Visa sent");

          const mountedDb = process.env.ENVOI_GATE5_MOUNTED_DB_CONTAINER;
          if (!mountedDb?.startsWith("supabase_db_gate5-auth-"))
            throw new Error("Disposable same-study database is unavailable.");
          execFileSync("docker", ["exec", mountedDb, "psql", "-U", "postgres",
            "-d", "postgres", "-v", "ON_ERROR_STOP=1",
            "-v", `offer_id=${first.id}`, "-f", "/tmp/gate5-same-study-report.sql"],
          { stdio: "pipe" });
          const qualifiedStudyId = study.data.id;
          const qualifiedRead = await page.request.get(
            `/api/researcher/studies/${qualifiedStudyId}/report`);
          expect(qualifiedRead.status()).toBe(200);
          expect(qualifiedRead.headers()["cache-control"]).toBe("private, no-store");
          const published = await qualifiedRead.json() as {
            reportId: string; studyId: string; summary: { version: number;
              hypotheses: { hypothesis: string; result: string }[];
              themes: { count: number; total: number; confidence: string;
                supportingQuotes: { studyId: string; transcriptId: string;
                  sourceVersion: string; startChar: number; endChar: number;
                  exactText: string }[] }[] };
          };
          expect(Object.keys(published).sort()).toEqual(["reportId", "studyId", "summary"]);
          expect(published).toMatchObject({
            studyId: qualifiedStudyId,
            reportId: "a9800000-0000-4000-8000-000000000001",
          });
          expect(published.summary.version).toBe(2);
          expect(published.summary.themes).toHaveLength(1);
          expect(published.summary.themes[0]).toMatchObject({
            count: 1, total: 10, confidence: "low",
          });
          expect(published.summary.hypotheses).toEqual([{
            hypothesis: "A clear meal choice reduces hesitation.", result: "untested",
          }]);
          const quote = published.summary.themes[0]?.supportingQuotes[0];
          expect(quote).toMatchObject({ studyId: qualifiedStudyId,
            startChar: 29, endChar: 42, exactText: "meal decision" });
          const sourceAnswer = await db.from("answers").select("id")
            .eq("session_id", session.data.id).eq("sequence", 1).single();
          expect(sourceAnswer.error).toBeNull();
          const source = await db.from("transcripts")
            .select("id,redacted_text,redacted_source_version")
            .eq("answer_id", sourceAnswer.data?.id).single();
          expect(source.error).toBeNull();
          expect(quote?.transcriptId).toBe(source.data?.id);
          expect(quote?.sourceVersion).toBe(source.data?.redacted_source_version);
          expect(Array.from(source.data?.redacted_text ?? "")
            .slice(quote?.startChar, quote?.endChar).join("")).toBe("meal decision");
          expect(JSON.stringify(published)).not.toMatch(/private fictional summary|Fictional private reason/i);
          await page.goto(`/app/studies/${qualifiedStudyId}`);
          await expect(page.getByRole("heading", { name: "Research report" })).toBeVisible();
          await expect(page.getByText("1 of 10 respondents · low confidence"))
            .toBeVisible();
          await expect(page.getByText("A clear meal choice reduces hesitation. · untested"))
            .toBeVisible();
          await expect(page.getByText("meal decision", { exact: true })).toBeVisible();
          const reportDownload = page.waitForEvent("download");
          await page.getByRole("button", { name: "Download themes and quotes CSV" }).click();
          const exported = await reportDownload;
          expect(exported.suggestedFilename())
            .toBe("envoi-labs-themes-and-quotes.csv");
          const csv = await readFile(await exported.path(), "utf8");
          expect(csv).toContain("meal decision");
          expect(csv).toContain('"1","10","low","supporting","meal decision"');
          expect(csv).not.toContain("A clear meal choice reduces hesitation.");
          expect(csv).toContain(`"${quote?.transcriptId}","${quote?.sourceVersion}","29","42"`);
          expect(csv).not.toMatch(/private fictional summary|Fictional private reason/i);
          const revokeSource = await db.from("consents").insert({
            respondent_id: first.respondent_id, purpose: "researcher_access",
            granted: false, text_version: "synthetic-same-study-revocation",
          });
          expect(revokeSource.error).toBeNull();
          const revokedRead = await page.request.get(
            `/api/researcher/studies/${qualifiedStudyId}/report`);
          expect(revokedRead.status()).toBe(404);
          expect(revokedRead.headers()["cache-control"]).toBe("private, no-store");
          let staleExportDownloaded = false;
          page.once("download", () => { staleExportDownloaded = true; });
          await page.getByRole("button", { name: "Download themes and quotes CSV" }).click();
          await expect(page.getByText("The report is currently unavailable.")).toBeVisible();
          expect(staleExportDownloaded).toBe(false);
          await page.reload();
          await expect(page.getByText("meal decision", { exact: true })).toHaveCount(0);
          await expect(page.getByRole("button", { name: "Download themes and quotes CSV" }))
            .toHaveCount(0);
          return;
        }
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
          await expect.poll(async () => (await secondContext.cookies(origin +
            "/api/respondent/auth/callback"))
            .some(({ name }) => name === "envoi-respondent-age")).toBe(true);
          const secondLink = await deliveredEmail(secondRespondent, secondEmail, origin,
            "/api/respondent/auth/callback");
          await secondRespondent.goto(secondLink.href);
          await expect(secondRespondent).toHaveURL(origin + "/r/status");
          const probeTurnId = randomUUID();
          const probeId = randomUUID();
          let answerCalls = 0;
          let pendingReads = 0;
          let releasePending: () => void = () => {};
          const pendingGate = new Promise<void>((resolve) => { releasePending = resolve; });
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
          let heldReadStatus: number | null = null;
          let withdrawalApplied = false;
          const freshAfterWithdrawal: number[] = [];
          await secondRespondent.route("**/api/respondent/sessions/start", async (route) => {
            const response = await route.fetch();
            const pendingRead = answerCalls === 0 && ++pendingReads <= 3;
            if (answerCalls === 0 && pendingReads === 4) await pendingGate;
            const held = holdNextRead;
            if (held) {
              heldReadStatus = response.status();
              signalReadStarted();
              await readGate;
              holdNextRead = false;
            }
            if (withdrawalApplied && !held) freshAfterWithdrawal.push(response.status());
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
              nextQuestion: pendingRead && current.nextQuestion
                ? { ...current.nextQuestion, text: "PRIVATE_ANSWER_SENTINEL" } : current.nextQuestion,
              probePending: pendingRead,
              currentProbe: answerCalls === 0 && !pendingRead ? { turnId: probeTurnId, probeId,
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
          await secondRespondent.emulateMedia({ reducedMotion: "reduce" });
          await secondRespondent.goto("/r");
          await secondRespondent.getByRole("button", { name: "Start answering" }).click();
          await expect(secondRespondent).toHaveURL(origin + `/r/interviews/${second.id}`);
          const preparing = secondRespondent.locator('p[role="status"]')
            .filter({ hasText: "Preparing this follow-up…" });
          await expect(preparing).toBeVisible();
          await expect(preparing).toHaveCSS("animation-name", "none");
          const home = secondRespondent.getByRole("link", { name: "Back to your studies" });
          await home.focus();
          await expect.poll(() => pendingReads).toBeGreaterThanOrEqual(4);
          await expect(home).toBeFocused();
          await expect(preparing).toHaveCount(1);
          await expect(secondRespondent.locator("body")).not.toContainText("PRIVATE_ANSWER_SENTINEL");
          releasePending();
          await expect(secondRespondent.getByRole("heading", { name: "What shaped your choice?" }))
            .toBeVisible();
          await expect(secondRespondent.getByRole("heading", { name: "What shaped your choice?" }))
            .toBeFocused();
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
          // Headless Chromium can keep every Playwright page visible. Emulate the
          // browser visibility signal to exercise the in-flight response race.
          await secondRespondent.evaluate(() => {
            Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
            document.dispatchEvent(new Event("visibilitychange"));
          });
          await expect.poll(() => secondRespondent.evaluate(() => document.visibilityState))
            .toBe("hidden");
          await expect(secondRespondent.getByRole("heading", { name: firstQuestion })).toHaveCount(0);
          releaseRead();
          await readFinished;
          expect(heldReadStatus).toBe(200);
          await expect(secondRespondent.getByRole("heading", { name: firstQuestion })).toHaveCount(0);
          const withdrawn = await db.from("consents").insert({
            respondent_id: second.respondent_id, purpose: "retention", granted: false,
            text_version: "synthetic-marketplace-withdrawal",
          });
          expect(withdrawn.error).toBeNull();
          withdrawalApplied = true;
          await secondRespondent.evaluate(() => {
            Reflect.deleteProperty(document, "visibilityState");
            document.dispatchEvent(new Event("visibilitychange"));
          });
          await expect.poll(() => secondRespondent.evaluate(() => document.visibilityState))
            .toBe("visible");
          await expect(secondRespondent.getByRole("heading", { name: firstQuestion })).toHaveCount(0);
          await expect(secondRespondent.getByRole("textbox", { name: "Type your answer" })).toHaveCount(0);
          await expect.poll(() => freshAfterWithdrawal)
            .toContain(409);
          await expect(secondRespondent.getByRole("main").getByRole("alert"))
            .toHaveText("This interview isn’t available anymore.");
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
