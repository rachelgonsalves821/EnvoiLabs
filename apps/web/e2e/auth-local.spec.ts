import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { exerciseVoiceRecording, submitSyntheticRecording } from "./respondent/voice-fixture";
import { deliveredCallback, localService, loopbackOrigin, totp, useDefaultTemplate } from "./support/disposable-auth";

const enabled = process.env.ENVOI_TEST_LOCAL_SUPABASE === "1";

test.describe("local Auth with synthetic fixtures", () => {
  test.skip(!enabled, "Requires a disposable loopback Supabase Auth stack.");
  test.skip(({ browserName }) => browserName !== "chromium", "Uses the disposable local Chromium project.");

  test("delivered email provisions the respondent and persists age attestation", async ({ browser, page, baseURL }) => {
    test.setTimeout(90_000);
    const origin = loopbackOrigin(baseURL);
    const service = localService();
    const email = `respondent-${randomUUID()}@example.test`;
    const expected = await service.from("respondents").select("id", { head: true, count: "exact" });
    expect(expected.error).toBeNull();

    await page.goto("/r/status");
    await expect(page).toHaveURL(/\/r\/signup$/);
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("checkbox", { name: /18 or older/ }).check();
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    const href = await deliveredCallback(page, email, origin, "/api/respondent/auth/callback");

    const stranger = await browser.newContext();
    try {
      const rejected = await stranger.newPage();
      await rejected.goto(origin + "/api/respondent/auth/callback?token_hash=synthetic&type=email");
      await expect(rejected).toHaveURL(/\/r\/signup\?error=expired$/);
      const beforeVerification = await service.from("respondents").select("id", { head: true, count: "exact" });
      expect(beforeVerification.error).toBeNull();
      expect(beforeVerification.count).toBe(expected.count);
    } finally {
      await stranger.close();
    }

    await page.goto(href);
    await expect(page).toHaveURL(/\/r\/status$/);
    await expect(page.getByRole("heading", { name: "You’re signed in" })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/r\/status$/);
    const cookies = await page.context().cookies();
    expect(cookies.some(({ name, httpOnly }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name) && httpOnly)).toBe(true);
    const listing = await service.auth.admin.listUsers();
    expect(listing.error).toBeNull();
    const user = listing.data?.users.find((candidate) => candidate.email === email);
    if (!user) throw new Error("Synthetic respondent was not created.");
    expect(user.email_confirmed_at).toBeTruthy();
    const row = await service.from("respondents").select("id,age_attested_at").eq("auth_user_id", user.id).single();
    expect(row.error).toBeNull();
    expect(row.data?.age_attested_at).toBeTruthy();
    if (!row.data) throw new Error("The synthetic respondent account is missing.");
    const respondentId = row.data.id;

    await test.step("save profile and separate consent choices through the signed-in mobile flow", async () => {
      await page.setViewportSize({ width: 360, height: 680 });
      await page.getByRole("link", { name: "Profile and privacy choices" }).click();
      await expect(page.getByRole("heading", { name: "Find studies that fit" })).toBeVisible();
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

      await expect(page.getByRole("heading", { name: "Choose what to share" })).toBeFocused();
      const voice = page.getByRole("checkbox", { name: /Record my voice answers/ });
      const researcher = page.getByRole("checkbox", { name: /Share my redacted answers/ });
      await expect(voice).not.toBeChecked();
      await expect(researcher).not.toBeChecked();
      await researcher.check();
      await page.getByRole("button", { name: "Save privacy choices" }).click();
      await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

      const profile = await service.from("profile_attributes").select("key,value_json").eq("respondent_id", respondentId);
      expect(profile.error).toBeNull();
      expect(profile.data).toHaveLength(9);
      expect(profile.data).toEqual(expect.arrayContaining([
        { key: "student", value_json: true },
        { key: "food_orders_per_week", value_json: 3 },
        { key: "region_zip", value_json: "02139" },
      ]));
      const decisions = await service.from("consents").select("purpose,granted,text_version")
        .eq("respondent_id", respondentId);
      expect(decisions.error).toBeNull();
      expect(decisions.data).toHaveLength(4);
      expect(decisions.data).toEqual(expect.arrayContaining([
        { purpose: "recording", granted: false, text_version: "gate1-preview-v1" },
        { purpose: "transcription_vendor", granted: false, text_version: "gate1-preview-v1" },
        { purpose: "retention", granted: false, text_version: "gate1-preview-v1" },
        { purpose: "researcher_access", granted: true, text_version: "gate1-preview-v1" },
      ]));

      await page.reload();
      await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();
      await page.getByRole("button", { name: "Review privacy choices" }).click();
      await expect(voice).not.toBeChecked();
      await expect(researcher).toBeChecked();
    });

    await test.step("the respondent can open and complete only their own interview", async () => {
      await page.goto("/r");
      await expect(page.getByRole("heading", { name: "Your studies" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "No study invitations yet" })).toBeVisible();

      const organization = await service.from("organizations").insert({ name: "Private Home fixture" }).select("id").single();
      if (organization.error || !organization.data) throw new Error("Could not create the synthetic organization.");
      const study = await service.from("studies").insert({
        organization_id: organization.data.id, title: "Internal project planning", state: "fielding",
        target_completes: 2, length_minutes: 8,
      }).select("id").single();
      if (study.error || !study.data) throw new Error("Could not create the synthetic study.");
      const studyId = study.data.id;
      const guide = await service.from("guide_questions").insert([1, 2, 3, 4].map((position) => ({
        study_id: studyId, position, text: `Private test question ${position}`,
      })));
      expect(guide.error).toBeNull();

      const otherUser = await service.auth.admin.createUser({ email: `other-${randomUUID()}@example.test`, email_confirm: true });
      if (otherUser.error || !otherUser.data.user) throw new Error("Could not create the second synthetic respondent.");
      const other = await service.rpc("provision_email_respondent", { supplied_user_id: otherUser.data.user.id });
      if (other.error || !other.data) throw new Error("Could not provision the second synthetic respondent.");
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const invites = await service.from("invites").insert([
        { study_id: studyId, respondent_id: respondentId, state: "invited", expires_at: expiresAt,
          reward_cents: 250, why_you_text: "Matched on delivery habits" },
        { study_id: studyId, respondent_id: other.data, state: "invited", expires_at: expiresAt,
          reward_cents: 999, why_you_text: "Another respondent’s reason" },
      ]).select("id,respondent_id");
      expect(invites.error).toBeNull();
      const ownInviteId = invites.data?.find(({ respondent_id }) => respondent_id === respondentId)?.id;
      const otherInviteId = invites.data?.find(({ respondent_id }) => respondent_id === other.data)?.id;
      if (!ownInviteId || !otherInviteId) throw new Error("The synthetic invitations are missing.");

      await page.reload();
      await expect(page.getByRole("heading", { name: "Research interview" })).toHaveCount(1);
      await expect(page.getByText("Matched on delivery habits")).toBeVisible();
      await expect(page.getByText("$2.50")).toBeVisible();
      await expect(page.getByText("8 min")).toBeVisible();
      await expect(page.getByText("4 questions")).toBeVisible();
      await expect(page.getByText("$9.99")).toHaveCount(0);
      await expect(page.getByText("Internal project planning")).toHaveCount(0);
      await expect(page.getByText("Private test question 1")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

      await page.getByRole("button", { name: "Start answering" }).click();
      await expect(page).toHaveURL(origin + "/r/interviews/" + ownInviteId);
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        "This interview isn’t available anymore.");
      await expect(page.getByRole("heading", { name: "Private test question 1" })).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Type your answer" })).toHaveCount(0);

      const session = await service.from("sessions").select("id,state").eq("invite_id", ownInviteId).single();
      expect(session.error).toBeNull();
      expect(session.data?.state).toBe("started");
      if (!session.data) throw new Error("The synthetic interview session is missing.");

      const answer = page.getByRole("textbox", { name: "Type your answer" });
      const save = page.getByRole("button", { name: "Save answer" });
      await expect(page.getByRole("button", { name: "Start recording" })).toHaveCount(0);
      const denied = await service.from("answers").select("id", { count: "exact", head: true }).eq("session_id", session.data.id);
      expect(denied.error).toBeNull();
      expect(denied.count).toBe(0);

      await page.goto("/r/onboarding");
      await page.getByRole("button", { name: "Review privacy choices" }).click();
      await page.getByRole("checkbox", { name: /Keep my study answers/ }).check();
      await page.getByRole("checkbox", { name: /Record my voice answers/ }).check();
      await page.getByRole("checkbox", { name: /Turn my voice answers into text/ }).check();
      await page.getByRole("button", { name: "Save privacy choices" }).click();
      await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();
      await exerciseVoiceRecording(page, origin, ownInviteId);

      await page.goto("/r/onboarding");
      await page.getByRole("button", { name: "Review privacy choices" }).click();
      await page.getByRole("checkbox", { name: /Record my voice answers/ }).uncheck();
      await page.getByRole("checkbox", { name: /Turn my voice answers into text/ }).uncheck();
      await page.getByRole("button", { name: "Save privacy choices" }).click();
      await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();
      await page.goto("/r/interviews/" + ownInviteId);
      await expect(page.getByRole("heading", { name: "Private test question 1" })).toBeVisible();

      for (const position of [1, 2]) {
        await expect(page.getByRole("heading", { name: `Private test question ${position}` })).toBeVisible();
        await answer.fill(`Synthetic answer ${position}`);
        await save.click();
        await expect(page.getByRole("heading", { name: `Private test question ${position + 1}` })).toBeFocused();
      }

      await page.reload();
      await expect(page.getByRole("heading", { name: "Private test question 3" })).toBeFocused();
      await expect(page.getByText("3 of 4")).toBeVisible();

      await page.getByRole("link", { name: "Back to your studies" }).click();
      await expect(page.getByText("In progress")).toBeVisible();
      const resumePath = await page.getByRole("link", { name: "Continue interview" }).getAttribute("href");
      if (!resumePath?.startsWith("/r/s/")) throw new Error("An active interview must have a signed resume path.");
      const reopened = await page.context().newPage();
      try {
        await reopened.goto(origin + resumePath);
        await expect(reopened.getByRole("heading", { name: "Private test question 3" })).toBeVisible();
        await expect(reopened.getByText("3 of 4")).toBeVisible();
      } finally {
        await reopened.close();
      }
      await page.getByRole("link", { name: "Continue interview" }).click();
      for (const position of [3, 4]) {
        await expect(page.getByRole("heading", { name: `Private test question ${position}` })).toBeVisible();
        await answer.fill(`Synthetic answer ${position}`);
        await save.click();
      }
      await expect(page.getByRole("heading", { name: "You’ve answered every question" })).toBeFocused();
      await page.getByRole("button", { name: "Submit interview" }).click();
      await expect(page.getByRole("heading", { name: "Interview submitted" })).toBeFocused();
      await expect(page.getByText("Pending quality check")).toBeVisible();
      const completed = await service.from("sessions").select("state").eq("id", session.data.id).single();
      expect(completed.error).toBeNull();
      expect(completed.data?.state).toBe("quality_hold");

      await page.goto("/r/interviews/" + otherInviteId);
      await expect(page.getByRole("main").getByRole("alert")).toHaveText("This interview isn’t available anymore.");
      await expect(page.getByRole("heading", { name: "Private test question 1" })).toHaveCount(0);

      await page.goto("/r/onboarding");
      await page.getByRole("button", { name: "Review privacy choices" }).click();
      await page.getByRole("checkbox", { name: /Record my voice answers/ }).check();
      await page.getByRole("checkbox", { name: /Turn my voice answers into text/ }).check();
      await page.getByRole("button", { name: "Save privacy choices" }).click();
      await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();

      const voiceStudy = await service.from("studies").insert({
        organization_id: organization.data.id, title: "Private voice fixture", state: "fielding",
        target_completes: 1, length_minutes: 8,
      }).select("id").single();
      if (voiceStudy.error || !voiceStudy.data) throw new Error("Could not create the second synthetic study.");
      const voiceStudyId = voiceStudy.data.id;
      const voiceGuide = await service.from("guide_questions").insert([1, 2, 3, 4].map((position) => ({
        study_id: voiceStudyId, position, text: `Synthetic voice question ${position}`,
      })));
      expect(voiceGuide.error).toBeNull();
      const voiceInvite = await service.from("invites").insert({
        study_id: voiceStudyId, respondent_id: respondentId, state: "invited",
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), reward_cents: 250,
      }).select("id").single();
      if (voiceInvite.error || !voiceInvite.data) throw new Error("Could not create the synthetic voice invitation.");

      await page.goto("/r");
      await page.getByRole("button", { name: "Start answering" }).click();
      await expect(page).toHaveURL(origin + "/r/interviews/" + voiceInvite.data.id);
      await expect(page.getByRole("heading", { name: "Synthetic voice question 1" })).toBeVisible();
      const spoken = await submitSyntheticRecording(page);
      await expect(page.getByRole("heading", { name: "Synthetic voice question 2" })).toBeFocused();
      expect(spoken.kind).toBe("voice");
      expect(spoken.durationMs).toBeGreaterThanOrEqual(1000);

      const [voiceAnswer, bucket] = await Promise.all([
        service.from("answers").select("kind,audio_object_id,duration_ms").eq("id", spoken.id).single(),
        service.storage.getBucket("gate1-interview-audio"),
      ]);
      expect(voiceAnswer.error).toBeNull();
      expect(voiceAnswer.data).toMatchObject({ kind: "voice", duration_ms: spoken.durationMs });
      expect(voiceAnswer.data?.audio_object_id).toBeTruthy();
      expect(bucket.error).toBeNull();
      expect(bucket.data?.public).toBe(false);
    });
  });

  test("researcher email and TOTP unlock drafts, idempotent preview launch and live tracking", async ({ page, baseURL }) => {
    test.setTimeout(45_000);
    const origin = loopbackOrigin(baseURL);
    const service = localService();
    const email = `auth-smoke-${randomUUID()}@example.test`;
    const created = await service.auth.admin.createUser({ email, email_confirm: !useDefaultTemplate });
    if (created.error || !created.data.user) throw new Error("Could not create the synthetic researcher.");
    const organization = await service.from("organizations").insert({ name: "Auth smoke fixture" }).select("id").single();
    if (organization.error || !organization.data) throw new Error("Could not create the synthetic organization.");
    const membership = await service.from("researchers").insert({
      auth_user_id: created.data.user.id,
      organization_id: organization.data.id,
      terms_version: "synthetic-test",
      terms_accepted_at: new Date().toISOString(),
    });
    expect(membership.error).toBeNull();

    await page.goto("/app/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await page.goto(await deliveredCallback(page, email, origin, "/api/researcher/auth/callback"));
    await expect(page).toHaveURL(/\/app\/mfa$/);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app\/mfa$/);
    await expect(page.locator("#new-study")).toHaveCount(0);
    const denied = await page.request.post("/api/researcher/studies", {
      headers: { origin, "idempotency-key": randomUUID() }, data: {},
    });
    expect(denied.status()).toBe(403);
    const preMfaTranscripts = await page.request.get(`/api/researcher/studies/${randomUUID()}/transcripts`);
    expect(preMfaTranscripts.status()).toBe(403);
    expect(await preMfaTranscripts.json()).toEqual({ ok: false });

    await page.getByRole("button", { name: "Show setup key" }).click();
    const setupKey = page.locator("main code");
    await expect(setupKey).toBeVisible();
    const secret = (await setupKey.textContent())?.trim();
    if (!secret) throw new Error("Synthetic authenticator key was missing.");
    await page.getByLabel("Authenticator code").fill(totp(secret, Date.now()));
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: "New study" })).toBeVisible();

    await page.getByLabel("Study title").fill("Late-night ordering study");
    await page.getByLabel("Target completes").fill("3");
    await page.getByLabel("Criterion 1", { exact: true }).selectOption("Ordered food after 10 pm in the last 30 days");
    await page.getByLabel("Criterion 2", { exact: true }).selectOption("Prefers ordering food in an app");
    const questions = [
      "When did you last order food after 10 pm?", "How did you choose what to order?",
      "What happened when you checked out?", "What made you use that app the next time?",
    ];
    for (const [index, question] of questions.entries()) {
      await page.getByLabel(`Question ${index + 1}`, { exact: true }).fill(question);
    }
    const [response] = await Promise.all([
      page.waitForResponse((item) => item.url().endsWith("/api/researcher/studies") && item.request().method() === "POST"),
      page.getByRole("button", { name: "Create draft" }).click(),
    ]);
    expect(response.status()).toBe(201);
    await expect(page.getByRole("heading", { name: "Study draft created" })).toBeVisible();
    const { studyId } = await response.json();
    expect(studyId).toBe(response.request().headers()["idempotency-key"]);
    const repeated = await page.request.post("/api/researcher/studies", {
      data: response.request().postDataJSON(), headers: { origin, "idempotency-key": studyId },
    });
    expect(repeated.status()).toBe(201);
    expect(await repeated.json()).toEqual({ studyId, state: "draft" });

    const [study, guide, createdEvents] = await Promise.all([
      service.from("studies").select("organization_id, state, target_completes").eq("id", studyId).single(),
      service.from("guide_questions").select("id, text, max_probes").eq("study_id", studyId).order("position"),
      service.from("events").select("name").eq("study_id", studyId).eq("name", "study.created"),
    ]);
    expect(study.data).toEqual({ organization_id: organization.data.id, state: "draft", target_completes: 3 });
    expect(guide.data).toHaveLength(4);
    expect(guide.data).toMatchObject(questions.map((text) => ({ text, max_probes: 0 })));
    expect(createdEvents.data).toEqual([{ name: "study.created" }]);

    const candidate = await service.auth.admin.createUser({
      email: `launch-candidate-${randomUUID()}@example.test`, email_confirm: true,
    });
    if (candidate.error || !candidate.data.user) throw new Error("Could not create the synthetic candidate.");
    const respondent = await service.from("respondents").insert({
      auth_user_id: candidate.data.user.id, age_attested_at: new Date().toISOString(),
    }).select("id").single();
    if (respondent.error || !respondent.data) throw new Error("Could not provision the synthetic candidate.");
    const profile = await service.from("profile_attributes").insert({
      respondent_id: respondent.data.id, key: "ordered_food_after_10pm_last_30_days", value_json: true, source: "signup",
    });
    expect(profile.error).toBeNull();
    const pricing = await service.from("pricing_configs").upsert({
      version: 100, active: true, params_json: { unitPriceCents: 100, incentivePerQuestionCents: 40 },
    }, { onConflict: "version" });
    expect(pricing.error).toBeNull();

    const [launch, retry] = await Promise.all([
      page.waitForResponse((item) => item.url().endsWith("/api/researcher/studies/launch")),
      page.request.post("/api/researcher/studies/launch", {
        headers: { origin }, data: { studyId, skip_payment: true },
      }),
      page.getByRole("button", { name: "Launch test study" }).click(),
    ]);
    expect(launch.status()).toBe(200);
    expect(retry.status()).toBe(200);
    expect(await launch.json()).toEqual({ studyId, state: "fielding" });
    expect(await retry.json()).toEqual({ studyId, state: "fielding" });
    await expect(page.getByRole("heading", { name: "Study launched" })).toBeFocused();
    const [offers, audits, payments] = await Promise.all([
      service.from("invites").select("id, respondent_id, state, reward_cents").eq("study_id", studyId),
      service.from("audit_log").select("id").eq("entity_id", studyId).eq("to_state", "fielding"),
      service.from("payments").select("id").eq("study_id", studyId),
    ]);
    expect(offers.data).toHaveLength(1);
    expect(offers.data).toMatchObject([{ respondent_id: respondent.data.id, state: "invited", reward_cents: 160 }]);
    expect(audits.data).toHaveLength(1);
    expect(payments.data).toEqual([]);

    await page.getByRole("link", { name: "View tracking" }).click();
    await expect(page).toHaveURL(`/app/studies/${studyId}`);
    await expect(page.getByRole("heading", { name: "Late-night ordering study" })).toBeVisible();
    await expect(page.getByText("0 of 3", { exact: true })).toBeVisible();

    const inviteId = offers.data?.[0]?.id;
    if (!inviteId) throw new Error("The seeded preview launch did not produce an invite.");
    const accepted = await service.from("invites").update({ state: "accepted" }).eq("id", inviteId);
    expect(accepted.error).toBeNull();
    const session = await service.from("sessions").insert({
      study_id: studyId, invite_id: inviteId, state: "quality_hold", submitted_at: new Date().toISOString(),
      started_at: new Date(Date.now() - 60_000).toISOString(),
    }).select("id").single();
    expect(session.error).toBeNull();
    await expect(page.getByText("1 of 3", { exact: true })).toBeVisible({ timeout: 12_000 });

    const endpoint = `/api/researcher/studies/${studyId}/transcripts`;
    const empty = { studyId, transcripts: [] };
    const redactedText = "I ordered [redacted] after class.";
    const transcriptPanel = page.getByRole("region", { name: "Redacted transcripts" });
    await expect(transcriptPanel.getByText("No redacted transcripts are available yet.")).toBeVisible();
    if (!session.data || !guide.data) throw new Error("The interview fixture is missing its session or guide.");
    const interviewId = session.data.id;
    const transcriptId = randomUUID();
    const questionFixtures = guide.data.slice(0, 3).map(({ id }, index) => ({
      id: randomUUID(), study_id: studyId, session_id: interviewId, guide_question_id: id, kind: "text", sequence: index + 1,
    }));
    const answers = await service.from("answers").insert(questionFixtures);
    expect(answers.error).toBeNull();
    const transcripts = await service.from("transcripts").insert(questionFixtures.map(({ id }, index) => ({
      id: index === 0 ? transcriptId : randomUUID(), study_id: studyId, answer_id: id,
      redacted_text: index === 0 ? redactedText : null, provider: "fixture", model: "fixture", latency_ms: 0, cost_micros: 0,
    })));
    expect(transcripts.error).toBeNull();
    expect(await (await page.request.get(endpoint)).json()).toEqual(empty);

    const consent = { respondent_id: respondent.data.id, study_id: studyId, purpose: "researcher_access", text_version: "fixture" };
    const grant = await service.from("consents").insert({ ...consent, granted: true });
    expect(grant.error).toBeNull();
    expect(await (await page.request.get(endpoint)).json()).toEqual(empty);
    expect(await (await page.request.get(endpoint + "?version=2")).json())
      .toEqual({ studyId, respondents: [] });
    const retention = await service.from("consents").insert({
      ...consent, purpose: "retention", granted: true,
    });
    expect(retention.error).toBeNull();
    const privateInput = await service.rpc("test_gate1_transcript_input", {
      supplied_answer_id: questionFixtures[0]!.id,
      supplied_raw_text: "I ordered soup after class.",
    });
    expect(privateInput.error).toBeNull();
    expect(privateInput.data).toBe(true);
    const claim = await service.rpc("claim_gate1_answer_job", {
      supplied_answer_id: questionFixtures[0]!.id,
    });
    expect(claim.error).toBeNull();
    const leaseId = (claim.data as { leaseId?: string } | null)?.leaseId;
    if (!leaseId) throw new Error("The synthetic transcript job did not produce a lease.");
    const complete = await service.rpc("complete_gate1_answer_job", {
      supplied_answer_id: questionFixtures[0]!.id,
      supplied_lease_id: leaseId,
      supplied_redacted_text: redactedText,
      supplied_redaction_passed: true,
      supplied_policy_digest: "a".repeat(64),
      supplied_qualification_digest: "b".repeat(64),
    });
    expect(complete.error).toBeNull();
    expect((complete.data as { status?: string } | null)?.status).toBe("published");
    const published = await page.request.get(endpoint);
    expect(published.headers()["cache-control"]).toBe("private, no-store");
    expect(await published.json()).toEqual({ studyId, transcripts: [{ id: transcriptId, redactedText }] });
    const grouped = await page.request.get(endpoint + "?version=2");
    expect(grouped.headers()["cache-control"]).toBe("private, no-store");
    const groupedBody = await grouped.json() as { respondents: { transcripts: { id: string; redactedText: string }[] }[] };
    expect(groupedBody.respondents.flatMap(({ transcripts: rows }) => rows))
      .toContainEqual({ id: transcriptId, redactedText });
    await expect(transcriptPanel.getByText(redactedText)).toBeVisible({ timeout: 12_000 });

    const withdrawal = await service.from("consents").insert({ ...consent, granted: false });
    expect(withdrawal.error).toBeNull();
    expect(await (await page.request.get(endpoint)).json()).toEqual(empty);
    expect(await (await page.request.get(endpoint + "?version=2")).json())
      .toEqual({ studyId, respondents: [] });
    await expect(transcriptPanel.getByText(redactedText)).toHaveCount(0, { timeout: 12_000 });

    const restore = await service.from("consents").insert({ ...consent, granted: true });
    expect(restore.error).toBeNull();
    const other = await service.from("organizations").insert({ name: "Other transcript fixture organization" }).select("id").single();
    if (other.error || !other.data) throw new Error("The other organization fixture could not be created.");
    const changeTenant = await service.from("researchers").update({ organization_id: other.data.id }).eq("auth_user_id", created.data.user.id);
    expect(changeTenant.error).toBeNull();
    expect(await (await page.request.get(endpoint)).json()).toEqual(empty);
  });
});
