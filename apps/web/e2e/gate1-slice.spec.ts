import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { devices, expect, test, type APIResponse, type Page } from "@playwright/test";
import { deliveredEmail, localService, loopbackOrigin, totp, useDefaultTemplate } from "./support/disposable-auth";
import { installSyntheticMicrophone, submitSyntheticRecording } from "./respondent/voice-fixture";

const runNode = promisify(execFile);
const questions = [
  "What led you to open a food ordering app?",
  "What did you look for in the menu?",
  "How did you decide which option to pick?",
  "What would you change about that order?",
] as const;
const title = "Food ordering app decisions";
const sensitiveFixture = "Synthetic speaker at private@example.test";
const redactedFixture = "Synthetic speaker at [EMAIL]";

async function raceDuplicatePost<T>(page: Page, path: string, action: () => Promise<T>): Promise<T> {
  let duplicate: APIResponse | undefined;
  await page.route(`**${path}`, async (route) => {
    const [response, replay] = await Promise.all([route.fetch(), route.fetch()]);
    duplicate = replay;
    await route.fulfill({ response });
  }, { times: 1 });
  const [response, output] = await Promise.all([
    page.waitForResponse((reply) => reply.request().method() === "POST" && new URL(reply.url()).pathname === path),
    action(),
  ]);
  if (!duplicate) throw new Error(`The duplicate ${path} request was not sent.`);
  try {
    expect(response.status()).toBe(200);
    expect(duplicate.status()).toBe(200);
    expect(await duplicate.json()).toEqual(await response.json());
  } finally {
    await duplicate.dispose();
  }
  return output;
}

async function requestRespondentEmail(page: Page, email: string) {
  await page.goto("/r/signup");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("checkbox", { name: /18 or older/ }).check();
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

async function createStudy(page: Page, email: string, origin: string) {
  await page.goto("/app/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const link = await deliveredEmail(page, email, origin, "/api/researcher/auth/callback");
  await page.goto(link.href);
  await expect(page).toHaveURL(/\/app\/mfa$/);
  await page.getByRole("button", { name: "Show setup key" }).click();
  const secret = (await page.locator("main code").textContent())?.trim();
  if (!secret) throw new Error("The disposable authenticator key is missing.");
  await page.getByLabel("Authenticator code").fill(totp(secret, Date.now()));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("heading", { name: "New study" })).toBeVisible();
  await page.getByLabel("Study title").fill(title);
  await page.getByLabel("Target completes").fill("2");
  await page.getByLabel("Criterion 1", { exact: true }).selectOption("Prefers ordering food in an app");
  await page.getByLabel("Criterion 2", { exact: true }).selectOption("Currently a student");
  for (const [index, question] of questions.entries()) {
    await page.getByLabel(`Question ${index + 1}`, { exact: true }).fill(question);
  }
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("heading", { name: "Study draft created" })).toBeVisible();
  await raceDuplicatePost(page, "/api/researcher/studies/launch", () =>
    page.getByRole("button", { name: "Launch test study" }).click());
  await expect(page.getByRole("heading", { name: "Study launched" })).toBeVisible();
  await page.getByRole("link", { name: "View tracking" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("0 of 2", { exact: true })).toBeVisible();
  return new URL(page.url()).pathname.split("/").at(-1);
}

test.describe("Gate 1 seeded study", () => {
  test.skip(process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1", "Requires the disposable Auth, database and Storage stack.");
  test.skip(({ browserName }) => browserName !== "chromium", "Uses Chromium MediaRecorder with synthetic input.");
  test.use({ actionTimeout: 12_000, navigationTimeout: 15_000 });

  test("IT-1.1, IT-1.3 and IT-1.5 match and resume four private recordings through concurrent retries", async ({
    browser, page: researcher, baseURL,
  }) => {
    test.setTimeout(180_000);
    const origin = loopbackOrigin(baseURL);
    const db = localService();
    const respondentEmail = `slice-respondent-${randomUUID()}@example.test`;
    const researcherEmail = `slice-researcher-${randomUUID()}@example.test`;
    const mobile = { ...devices["Pixel 7"], baseURL: origin };
    const respondentContext = await browser.newContext(mobile);
    const returningContext = await browser.newContext(mobile);
    for (const context of [respondentContext, returningContext]) {
      context.setDefaultTimeout(12_000);
      context.setDefaultNavigationTimeout(15_000);
    }

    try {
      const respondent = await respondentContext.newPage();
      await installSyntheticMicrophone(respondent);
      await requestRespondentEmail(respondent, respondentEmail);
      const firstLink = await deliveredEmail(respondent, respondentEmail, origin, "/api/respondent/auth/callback");
      await respondent.goto(firstLink.href);
      await expect(respondent.getByRole("heading", { name: "You’re signed in" })).toBeVisible();
      await respondent.getByRole("link", { name: "Profile and privacy choices" }).click();
      await respondent.getByLabel("What’s your age range?").selectOption("18-24");
      await respondent.getByLabel("How do you describe your gender?").selectOption("undisclosed");
      await respondent.getByLabel("Are you currently in school?").selectOption("year_2");
      await respondent.getByLabel("Do you live on campus?").selectOption("true");
      await respondent.getByLabel("How often do you shop online?").selectOption("weekly");
      await respondent.getByLabel("What’s your ZIP code?").fill("02139");
      await respondent.getByLabel("How many times do you order food in a typical week?").fill("3");
      await respondent.getByRole("checkbox", { name: "Food and drink" }).check();
      await respondent.getByRole("checkbox", { name: "Technology" }).check();
      await respondent.getByRole("button", { name: "Save and continue" }).click();
      await expect(respondent.getByRole("heading", { name: "Choose what to share" })).toBeVisible();
      for (const name of [
        "Record my voice answers", "Turn my voice answers into text",
        "Keep my study answers", "Share my redacted answers with researchers",
      ]) {
        await respondent.getByRole("checkbox", { name }).check();
      }
      await respondent.getByRole("button", { name: "Save privacy choices" }).click();
      await expect(respondent.getByRole("heading", { name: "Your account is ready" })).toBeVisible();

      const listed = await db.auth.admin.listUsers();
      expect(listed.error).toBeNull();
      const authUser = listed.data?.users.find(({ email }) => email === respondentEmail);
      if (!authUser) throw new Error("The synthetic respondent was not provisioned.");
      const account = await db.from("respondents").select("id,age_attested_at").eq("auth_user_id", authUser.id).single();
      if (account.error || !account.data) throw new Error("The synthetic respondent account was not provisioned.");
      const { id: respondentId } = account.data;
      expect(account.data.age_attested_at).toBeTruthy();
      // Gate 2 collects this screening attribute. Gate 1 seeds it after the respondent completes onboarding.
      const match = await db.from("profile_attributes").insert({
        respondent_id: respondentId, key: "preferred_food_order_channel", value_json: "app", source: "signup",
      });
      expect(match.error).toBeNull();

      const org = await db.from("organizations").insert({ name: title }).select("id").single();
      if (org.error || !org.data) throw new Error("The synthetic researcher organization is missing.");
      const authResearcher = await db.auth.admin.createUser({ email: researcherEmail, email_confirm: !useDefaultTemplate });
      if (authResearcher.error || !authResearcher.data.user) throw new Error("The synthetic researcher is missing.");
      const membership = await db.from("researchers").insert({
        auth_user_id: authResearcher.data.user.id, organization_id: org.data.id,
        terms_version: "synthetic-test", terms_accepted_at: new Date().toISOString(),
      });
      expect(membership.error).toBeNull();
      const pricing = await db.from("pricing_configs").upsert({
        version: 100, active: true, params_json: { unitPriceCents: 100, incentivePerQuestionCents: 40 },
      }, { onConflict: "version" });
      expect(pricing.error).toBeNull();

      const studyId = await test.step("Launch the study from the researcher workspace", () =>
        createStudy(researcher, researcherEmail, origin));
      if (!studyId) throw new Error("The launch did not open the seeded study.");
      const selected = await db.from("invites").select("id,respondent_id,state").eq("study_id", studyId).single();
      if (selected.error || !selected.data) throw new Error("Matching did not produce exactly one invite.");
      expect(selected.data).toMatchObject({ respondent_id: respondentId, state: "invited" });
      const launchAudit = await db.from("audit_log").select("id", { count: "exact", head: true })
        .eq("entity", "study").eq("entity_id", studyId).eq("to_state", "fielding");
      expect(launchAudit.error).toBeNull();
      expect(launchAudit.count).toBe(1);
      const inviteId = selected.data.id;
      const someoneElse = await db.auth.admin.createUser({ email: `slice-other-${randomUUID()}@example.test`, email_confirm: true });
      if (someoneElse.error || !someoneElse.data.user) throw new Error("The second synthetic respondent is missing.");
      const other = await db.rpc("provision_email_respondent", { supplied_user_id: someoneElse.data.user.id });
      if (other.error || !other.data) throw new Error("The second synthetic account is missing.");
      const otherInvite = await db.from("invites").insert({
        study_id: studyId, respondent_id: other.data, state: "invited", reward_cents: 999,
        why_you_text: "Other account’s study invitation", expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }).select("id").single();
      if (otherInvite.error || !otherInvite.data) throw new Error("The other account’s invitation is missing.");

      await respondent.goto("/r");
      await expect(respondent.getByRole("heading", { name: "Research interview" })).toHaveCount(1);
      await expect(respondent.getByText("$1.60")).toBeVisible();
      await expect(respondent.getByText("$9.99")).toHaveCount(0);
      await expect(respondent.getByText("Other account’s study invitation")).toHaveCount(0);
      await raceDuplicatePost(respondent, "/api/respondent/invites/accept", () =>
        respondent.getByRole("button", { name: "Start answering" }).click());
      await expect(respondent).toHaveURL(origin + "/r/interviews/" + inviteId);
      const acceptanceAudit = await db.from("audit_log").select("id", { count: "exact", head: true })
        .eq("entity", "invite").eq("entity_id", inviteId).eq("to_state", "accepted");
      expect(acceptanceAudit.error).toBeNull();
      expect(acceptanceAudit.count).toBe(1);
      await expect(respondent.getByRole("heading", { name: questions[0] })).toBeVisible();
      const answers = [await submitSyntheticRecording(respondent)];
      await expect(respondent.getByRole("heading", { name: questions[1] })).toBeVisible();
      answers.push(await raceDuplicatePost(respondent, "/api/respondent/answers/record", () =>
        submitSyntheticRecording(respondent)));
      await respondent.getByRole("link", { name: "Back to your studies" }).click();
      const resumePath = await respondent.getByRole("link", { name: "Continue interview" }).getAttribute("href");
      if (!resumePath?.startsWith("/r/s/")) throw new Error("The in-progress interview has no signed resume link.");
      await respondent.close();

      const returning = await returningContext.newPage();
      await installSyntheticMicrophone(returning);
      await requestRespondentEmail(returning, respondentEmail);
      const secondLink = await deliveredEmail(returning, respondentEmail, origin, "/api/respondent/auth/callback", firstLink.id);
      await returning.goto(secondLink.href);
      await expect(returning.getByRole("heading", { name: "You’re signed in" })).toBeVisible();
      await returning.goto("/r");
      await expect(returning.getByText("In progress")).toBeVisible();
      await expect(returning.getByRole("link", { name: "Continue interview" })).toHaveCount(1);
      await returning.goto(origin + resumePath);
      await expect(returning.getByText("3 of 4")).toBeVisible();
      for (const question of questions.slice(2)) {
        await expect(returning.getByRole("heading", { name: question })).toBeVisible();
        answers.push(await submitSyntheticRecording(returning));
      }
      await returning.getByRole("button", { name: "Submit interview" }).click();
      await expect(returning.getByRole("heading", { name: "Interview submitted" })).toBeVisible();
      await expect(returning.getByText("Pending quality check")).toBeVisible();
      const session = await db.from("sessions").select("id,state").eq("invite_id", inviteId).single();
      expect(session.error).toBeNull();
      expect(session.data).toEqual({ id: answers[0]?.sessionId, state: "quality_hold" });
      expect(new Set(answers.map(({ sessionId }) => sessionId)).size).toBe(1);
      expect(new Set(answers.map(({ guideQuestionId }) => guideQuestionId)).size).toBe(4);
      const persisted = await db.from("answers").select("id").eq("session_id", session.data?.id);
      expect(persisted.error).toBeNull();
      expect(persisted.data?.map(({ id }) => id).sort()).toEqual(answers.map(({ id }) => id).sort());
      await returning.goto(origin + "/r/interviews/" + otherInvite.data.id);
      await expect(returning.getByRole("main").getByRole("alert")).toHaveText("This interview isn’t available anymore.");

      await expect(researcher.getByText("1 of 2", { exact: true })).toBeVisible({ timeout: 12_000 });
      const panel = researcher.getByRole("region", { name: "Redacted transcripts" });
      await expect(panel.getByText("No redacted transcripts are available yet.")).toBeVisible();
      await expect(panel.getByRole("article")).toHaveCount(0);
      const workerPath = resolve(__dirname, "support", "process-gate1-voice.mjs");
      const result = await runNode(process.execPath, [workerPath, ...answers.map(({ id }) => id)], { timeout: 30_000 });
      expect(result.stdout.trim()).toBe("4");
      const group = panel.getByRole("article", { name: "Respondent 1" });
      await expect(group.getByText(redactedFixture, { exact: true })).toHaveCount(4, { timeout: 12_000 });
      await expect(group.getByText("Student", { exact: true })).toBeVisible();
      await expect(panel.getByRole("article")).toHaveCount(1);
      await expect(panel.getByText(sensitiveFixture, { exact: true })).toHaveCount(0);

      const oldResponse = await researcher.request.get("/api/researcher/studies/" + studyId + "/transcripts");
      expect(oldResponse.ok()).toBe(true);
      expect(oldResponse.headers()["cache-control"]).toContain("no-store");
      const oldPayload = await oldResponse.json();
      expect(Object.keys(oldPayload).sort()).toEqual(["studyId", "transcripts"]);
      expect(oldPayload.transcripts).toHaveLength(4);

      const withdrawal = await db.from("consents").insert({
        respondent_id: respondentId, purpose: "researcher_access", granted: false, text_version: "synthetic-withdrawal",
      });
      expect(withdrawal.error).toBeNull();
      await expect(panel.getByText("No redacted transcripts are available yet.")).toBeVisible({ timeout: 12_000 });
      await expect(group).toHaveCount(0);
    } finally {
      await Promise.allSettled([respondentContext.close(), returningContext.close()]);
    }
  });
});
