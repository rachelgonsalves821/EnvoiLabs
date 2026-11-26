import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { publishGate2ScreeningRedaction } from
  "@envoi-labs/services/screening-redaction-publisher";
import { decideQualifiedScreeningAnswer } from
  "@envoi-labs/services/qualified-screening-decision";
import { installSyntheticMicrophone } from "./respondent/voice-fixture";
import { deliveredEmail, localService, loopbackOrigin } from "./support/disposable-auth";

const runNode = promisify(execFile);
test.describe("Gate 2 consented voice screener fixture", () => {
  test.skip(process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1", "Requires disposable local Auth and database.");
  test.skip(({ browserName }) => browserName !== "chromium", "Uses disposable Chromium Auth.");

  test("private voice upload reaches a qualified synthetic decision and withdrawal hides its source", async ({ browser, baseURL }) => {
    test.setTimeout(200_000);
    const origin = loopbackOrigin(baseURL);
    const db = localService();
    const email = `gate2-voice-${randomUUID()}@example.test`;
    const question = "Have you worked as a hospital nurse in the past 12 months?";
    const context = await browser.newContext({ baseURL: origin });
    try {
      const page = await context.newPage();
      await installSyntheticMicrophone(page);
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
      if (!user) throw new Error("Disposable voice respondent user is missing.");
      const profile = await db.from("respondents").select("id")
        .eq("auth_user_id", user.id).single();
      if (profile.error || !profile.data) throw new Error("Disposable voice profile is missing.");
      const org = await db.from("organizations").insert({ name: "Synthetic voice screening study" })
        .select("id").single();
      if (org.error || !org.data) throw new Error("Disposable organization is missing.");
      const approver = await db.auth.admin.createUser({ email:
        `gate2-voice-approver-${randomUUID()}@example.test`, email_confirm: true });
      if (approver.error || !approver.data.user) throw new Error("Disposable approver is missing.");
      const researcher = await db.from("researchers").insert({
        auth_user_id: approver.data.user.id, organization_id: org.data.id,
        terms_version: "synthetic-test", terms_accepted_at: new Date().toISOString(),
      }).select("id").single();
      if (researcher.error || !researcher.data) throw new Error("Disposable researcher is missing.");
      const study = await db.from("studies").insert({ organization_id: org.data.id,
        title: "Synthetic voice screener", state: "fielding", target_completes: 10,
        length_minutes: 10, deadline_at: new Date(Date.now() + 86_400_000).toISOString(),
      }).select("id").single();
      if (study.error || !study.data) throw new Error("Disposable study is missing.");
      const guide = await db.from("guide_questions").insert({
        study_id: study.data.id, position: 1,
        text: "Describe a recent nursing shift.",
      });
      expect(guide.error).toBeNull();
      const criterion = await db.from("criteria").insert({ study_id: study.data.id,
        kind: "must", attribute_key: "nurse", operator: "eq", value_json: true,
        text: "Worked as a hospital nurse in the past 12 months",
      }).select("id").single();
      if (criterion.error || !criterion.data) throw new Error("Disposable criterion is missing.");
      const rule = await db.from("gate2_screening_rules").insert({
        study_id: study.data.id, criterion_id: criterion.data.id, version: 1,
        criterion_kind: "must", criterion_text: "Worked as a hospital nurse in the past 12 months",
        timeframe_text: "past 12 months", question,
        approved_by: researcher.data.id, approved_at: new Date(Date.now() - 1000).toISOString(),
      }).select("id").single();
      if (rule.error || !rule.data) throw new Error("Disposable voice rule is missing.");
      const offer = await db.from("invites").insert({ study_id: study.data.id,
        respondent_id: profile.data.id, state: "screening", reward_cents: 100,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }).select("id").single();
      if (offer.error || !offer.data) throw new Error("Disposable voice offer is missing.");
      const consents = await db.from("consents").insert(
        ["retention", "recording", "transcription_vendor"].map((purpose) => ({
          respondent_id: profile.data.id, study_id: study.data.id, purpose,
          granted: true, text_version: "synthetic-screening-voice",
        })));
      expect(consents.error).toBeNull();

      await page.goto(`/r/screening/${offer.data.id}`);
      await expect(page.getByText(question)).toBeVisible();
      await page.evaluate(() => {
        (window as unknown as { syntheticMicrophone: { allowed: boolean } }).syntheticMicrophone.allowed = true;
      });
      await page.getByRole("button", { name: "Record an answer" }).click();
      await expect(page.getByText(/Recording: [1-9]/)).toBeVisible();
      await page.getByRole("button", { name: "Stop recording" }).click();
      await expect(page.getByRole("button", { name: "Submit recording" })).toBeVisible();
      const audioEndpoint = `/api/respondent/screening/${offer.data.id}/audio`;
      const reservedPromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === audioEndpoint && response.request().method() === "POST");
      const uploadedPromise = page.waitForResponse((response) => response.request().method() === "PUT"
        && new URL(response.url()).pathname.startsWith(
          "/storage/v1/object/upload/sign/gate2-screening-audio/"));
      const confirmedPromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === audioEndpoint && response.request().method() === "PUT");
      await page.getByRole("button", { name: "Submit recording" }).click();
      const [reserved, uploaded, confirmed] = await Promise.all([
        reservedPromise, uploadedPromise, confirmedPromise,
      ]);
      expect(reserved.status()).toBe(200);
      expect(uploaded.ok()).toBe(true);
      expect((await uploaded.request().allHeaders()).cookie).toBeUndefined();
      expect(confirmed.status()).toBe(200);
      const reservation = await reserved.json() as { audioObjectId: string };
      await expect(page.getByText("Your recording is being transcribed. Check back shortly.")).toBeVisible();
      await page.reload();
      await expect(page.getByText("Your recording is being transcribed. Check back shortly.")).toBeVisible();

      const workerPath = resolve(__dirname, "support", "process-gate2-screening-voice.mjs");
      const processed = await runNode(process.execPath, [workerPath, reservation.audioObjectId],
        { timeout: 30_000 });
      const completion = JSON.parse(processed.stdout.trim()) as {
        status: string; answerId: string };
      expect(completion.status).toBe("completed");
      expect(completion.answerId).toMatch(/^[a-f0-9-]{36}$/);
      await page.reload();
      await expect(page.getByText("Your answer is awaiting review.")).toBeVisible();
      await expect(page.getByText("I worked as a hospital nurse three months ago.")).toHaveCount(0);
      const events = await db.from("gate2_screening_events").select("id").eq("rule_id", rule.data.id);
      expect(events.error).toBeNull();
      expect(events.data).toEqual([]);
      const unchanged = await db.from("invites").select("state").eq("id", offer.data.id).single();
      expect(unchanged.error).toBeNull();
      expect(unchanged.data?.state).toBe("screening");

      // This purpose and policy are installed only in the disposable Auth job.
      const purpose = await db.from("consents").insert({
        respondent_id: profile.data.id, study_id: study.data.id,
        purpose: "ai_screening", granted: true,
        text_version: "synthetic-ai-screening-v1",
      }).select("id").single();
      if (purpose.error || !purpose.data) throw new Error("Synthetic purpose missing");
      const receipt = await db.rpc("test_gate2_screening_purpose_receipt" as never,
        { supplied_consent_id: purpose.data.id } as never);
      expect(receipt.error).toBeNull();
      expect(receipt.data).toBe(true);
      const answerText = "I worked as a hospital nurse three months ago.";
      const qualified = await publishGate2ScreeningRedaction(db,
        { policyDigest: "a".repeat(64), qualificationDigest: "b".repeat(64),
          redact: async (raw) => {
            expect(raw).toBe(answerText);
            return answerText;
          } }, {
          answerId: completion.answerId, policyDigest: "a".repeat(64),
          qualificationDigest: "b".repeat(64),
          idempotencyKey: `gate2-redaction:${randomUUID()}`,
        });
      expect(qualified?.qualified).toBe(true);
      const request = { studyId: study.data.id, answerId: completion.answerId,
        ruleId: rule.data.id, ruleVersion: 1,
        providerModel: "synthetic-model", promptVersion: "screening-v1",
        promptDigest: "c".repeat(64) };
      let modelCalls = 0;
      const model = {
        async interpret(source: { answerText: string; redactedSourceVersion: string }) {
          modelCalls += 1;
          expect(source).toMatchObject({ answerText,
            redactedSourceVersion: qualified?.sourceVersion });
          return { result: "supported", span: {
            startChar: 0, endChar: Array.from(answerText).length } };
        },
        async evidenceSupports(source: { answerText: string; result: string;
          criterionText: string; span: { startChar: number; endChar: number } }) {
          return source.answerText === answerText && source.result === "supported" &&
            source.criterionText === "Worked as a hospital nurse in the past 12 months" &&
            Array.from(source.answerText).slice(source.span.startChar,
              source.span.endChar).join("") === answerText;
        },
      };
      expect((await decideQualifiedScreeningAnswer(db, model, request))?.action)
        .toBe("qualify");
      expect((await decideQualifiedScreeningAnswer(db, model, request))?.action)
        .toBe("qualify");
      expect(modelCalls).toBe(1);
      const invited = await db.from("invites").select("state")
        .eq("id", offer.data.id).single();
      expect(invited.error).toBeNull();
      expect(invited.data?.state).toBe("invited");
      await page.goto("/r");
      await expect(page.getByRole("button", { name: "Start answering" })).toBeVisible();

      const withdrawn = await db.from("consents").insert({ respondent_id: profile.data.id,
        study_id: study.data.id, purpose: "transcription_vendor", granted: false,
        text_version: "synthetic-screening-withdrawal" });
      expect(withdrawn.error).toBeNull();
      const staleSource = await db.rpc("current_gate2_screening_model_source", {
        requested_study_id: request.studyId,
        requested_answer_id: request.answerId,
        requested_rule_id: request.ruleId,
        requested_rule_version: request.ruleVersion,
        requested_provider_model: request.providerModel,
        requested_prompt_version: request.promptVersion,
        requested_prompt_digest: request.promptDigest,
      });
      expect(staleSource.error).toBeNull();
      expect(staleSource.data).toBeNull();
      expect(await decideQualifiedScreeningAnswer(db, model, request)).toBeNull();
      expect(modelCalls).toBe(1);
      const staleAccept = await page.request.post("/api/respondent/invites/accept", {
        data: { inviteId: offer.data.id, action: "accept" },
      });
      expect(staleAccept.status()).toBe(409);
      const noInterview = await db.from("sessions").select("id")
        .eq("invite_id", offer.data.id);
      expect(noInterview.error).toBeNull();
      expect(noInterview.data).toEqual([]);
      await page.goto("/r");
      await expect(page.getByRole("button", { name: "Start answering" })).toHaveCount(0);
      await page.goto(`/r/screening/${offer.data.id}`);
      await page.reload();
      await expect(page.getByText("Your answer is awaiting review.")).toHaveCount(0);
      await expect(page.getByText(answerText)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
