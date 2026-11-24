import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { localService, loopbackOrigin } from "./support/disposable-auth";

const maxBucketBytes = 20 * 1024 * 1024;

test.skip(process.env.ENVOI_GATE4_AUDIO_LOCAL !== "1" ||
  process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1", "Requires the disposable Gate 4 Auth/Storage database stack.");
test.skip(({ browserName }) => browserName !== "chromium", "Synthetic local Chromium fixture.");

function reservationCount(sessionId: string) {
  const container = process.env.ENVOI_GATE4_DB_CONTAINER;
  if (!/^supabase_db_gate4-[a-z0-9-]+$/.test(container ?? "")) {
    throw new Error("Gate 4 fixture requires its disposable database container.");
  }
  if (!/^[a-f\d-]{36}$/i.test(sessionId)) throw new Error("Invalid synthetic session ID.");
  const sql = `select count(*) from internal.gate1_audio_uploads where session_id='${sessionId}'`;
  return Number(execFileSync("docker", ["exec", container!, "psql", "-U", "postgres", "-d", "postgres",
    "-Atqc", sql], { encoding: "utf8" }).trim());
}

test("two local web processes share authenticated audio reservation quota", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const first = loopbackOrigin(baseURL);
  const second = loopbackOrigin(process.env.ENVOI_GATE4_SECOND_ORIGIN);
  const mailpit = loopbackOrigin(process.env.ENVOI_GATE4_MAILPIT_URL);
  const service = localService();
  const nonce = randomUUID();
  const hex = nonce.replaceAll("-", "");
  const source = `2001:db8:${hex.slice(0, 4)}:${hex.slice(4, 8)}:${hex.slice(8, 12)}:${hex.slice(12, 16)}::1`;
  const email = `gate4-audio-${nonce}@example.test`;
  const context = await browser.newContext({ baseURL: first,
    extraHTTPHeaders: { "x-vercel-forwarded-for": source } });
  try {
    const page = await context.newPage();
    await page.goto("/r/signup");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("checkbox", { name: /18 or older/ }).check();
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    let messageId: string | undefined;
    await expect.poll(async () => {
      const inbox = await context.request.get(`${mailpit}/api/v1/search`, { params: { query: `to:${email}` } });
      if (!inbox.ok()) throw new Error("Disposable Mailpit search failed.");
      const data: { messages: { ID: string }[] } = await inbox.json();
      messageId = data.messages[0]?.ID;
      return Boolean(messageId);
    }, { timeout: 20_000 }).toBe(true);
    const message = await context.request.get(`${mailpit}/api/v1/message/${encodeURIComponent(messageId!)}`);
    expect(message.ok()).toBe(true);
    const delivered: { HTML: string } = await message.json();
    const href = await page.evaluate((html) => new DOMParser().parseFromString(html, "text/html")
      .querySelector("a")?.getAttribute("href"), delivered.HTML);
    if (!href) throw new Error("Synthetic sign-in link missing.");
    const callback = new URL(href);
    const provider = loopbackOrigin(process.env.SUPABASE_URL);
    if (callback.pathname === "/auth/v1/verify") {
      if (callback.origin !== provider ||
        callback.searchParams.get("redirect_to") !== `${first}/api/respondent/auth/callback`) {
        throw new Error("Provider link must return to the disposable app callback.");
      }
    } else if (callback.origin !== first || callback.pathname !== "/api/respondent/auth/callback") {
      throw new Error("Sign-in link left the disposable origins.");
    }
    await page.goto(callback.href);
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
    for (const name of ["Record my voice answers", "Turn my voice answers into text",
      "Keep my study answers", "Share my redacted answers with researchers"]) {
      await page.getByRole("checkbox", { name }).check();
    }
    await page.getByRole("button", { name: "Save privacy choices" }).click();
    await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();

    const users = await service.auth.admin.listUsers();
    const user = users.data?.users.find((candidate) => candidate.email === email);
    if (users.error || !user) throw new Error("Synthetic respondent missing.");
    const respondent = await service.from("respondents").select("id").eq("auth_user_id", user.id).single();
    if (respondent.error || !respondent.data) throw new Error("Synthetic respondent row missing.");
    const org = await service.from("organizations").insert({ name: "Gate 4 synthetic audio limit" })
      .select("id").single();
    if (org.error || !org.data) throw new Error("Synthetic organization missing.");
    const study = await service.from("studies").insert({ organization_id: org.data.id,
      title: "Gate 4 synthetic audio interview", state: "fielding", target_completes: 1,
      length_minutes: 8 }).select("id").single();
    if (study.error || !study.data) throw new Error("Synthetic study missing.");
    const guide = await service.from("guide_questions").insert([1, 2, 3, 4].map((position) => ({
      study_id: study.data.id, position, text: `Synthetic audio question ${position}`,
    }))).select("id,position");
    if (guide.error || guide.data?.length !== 4) throw new Error("Synthetic guide missing.");
    const invite = await service.from("invites").insert({ study_id: study.data.id,
      respondent_id: respondent.data.id, state: "invited", reward_cents: 250,
      why_you_text: "Synthetic audio limit fixture", expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }).select("id").single();
    if (invite.error || !invite.data) throw new Error("Synthetic invite missing.");
    await page.goto("/r");
    await page.getByRole("button", { name: "Start answering" }).click();
    await expect(page.getByRole("heading", { name: "Synthetic audio question 1" })).toBeVisible();
    const session = await service.from("sessions").select("id").eq("invite_id", invite.data.id).single();
    if (session.error || !session.data) throw new Error("Synthetic session missing.");
    const question = guide.data.find((item) => item.position === 1);
    if (!question) throw new Error("First question missing.");
    expect(reservationCount(session.data.id)).toBe(0);

    const payload = { sessionId: session.data.id, guideQuestionId: question.id,
      bytes: 1024, mime: "audio/webm" };
    const headers = (origin: string) => ({ Origin: origin, "x-vercel-forwarded-for": source });
    const unauth = await browser.newContext();
    try {
      const response = await unauth.request.post(`${second}/api/respondent/answers/upload`,
        { data: payload, headers: headers(second) });
      expect(response.status()).toBe(401);
    } finally { await unauth.close(); }
    const invalid = await context.request.post(`${first}/api/respondent/answers/upload`,
      { data: { ...payload, mime: "video/webm" }, headers: headers(first) });
    expect(invalid.status()).toBe(400);
    expect(reservationCount(session.data.id)).toBe(0);

    const responses = await Promise.all(Array.from({ length: 24 }, (_, index) => {
      const origin = index % 2 ? first : second;
      return context.request.post(`${origin}/api/respondent/answers/upload`,
        { data: payload, headers: headers(origin) });
    }));
    const accepted = responses.filter((response) => response.status() === 200);
    const limited = responses.filter((response) => response.status() === 429);
    expect(accepted).toHaveLength(10);
    expect(limited).toHaveLength(14);
    expect(reservationCount(session.data.id)).toBe(10);
    for (const response of limited) {
      expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0);
      expect(await response.json()).toEqual({ ok: false });
    }
    let firstUpload: { uploadUrl: string; audioObjectId: string } | undefined;
    for (const response of accepted) {
      const body = await response.json();
      expect(body.audioObjectId).toMatch(/^[a-f\d-]{36}$/i);
      expect(body.uploadUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
      firstUpload ??= body;
    }
    if (!firstUpload) throw new Error("Synthetic signed upload is missing.");
    const signedUrl = new URL(firstUpload.uploadUrl);
    expect(signedUrl.origin).toBe(provider);
    expect(signedUrl.pathname).toContain(`/${session.data.id}/${firstUpload.audioObjectId}`);
    const validAudio = Buffer.alloc(payload.bytes);
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(validAudio);
    const changedPath = new URL(signedUrl);
    changedPath.pathname = changedPath.pathname.replace(firstUpload.audioObjectId, randomUUID());
    const wrongPath = await context.request.put(changedPath.href, {
      data: validAudio, headers: { "Content-Type": payload.mime },
    });
    expect(wrongPath.ok()).toBe(false);
    const wrongMime = await context.request.put(signedUrl.href, {
      data: validAudio, headers: { "Content-Type": "video/webm" },
    });
    expect(wrongMime.ok()).toBe(false);
    const tooLarge = await context.request.put(signedUrl.href, {
      data: Buffer.alloc(maxBucketBytes + 1), headers: { "Content-Type": payload.mime },
    });
    expect(tooLarge.ok()).toBe(false);
    const correct = await context.request.put(signedUrl.href, {
      data: validAudio, headers: { "Content-Type": payload.mime },
    });
    expect(correct.ok()).toBe(true);
  } finally { await context.close(); }
});
