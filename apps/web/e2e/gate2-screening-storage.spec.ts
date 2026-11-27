import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { deliveredEmail, localService, loopbackOrigin } from "./support/disposable-auth";

const bucket = "gate2-screening-audio";
const media = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
const replacement = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 1, 1, 1]);

test.describe("Gate 2 private screening Storage", () => {
  test.skip(process.env.ENVOI_TEST_LOCAL_SUPABASE !== "1",
    "Requires a disposable Auth and Storage stack.");
  test.skip(({ browserName }) => browserName !== "chromium",
    "Uses disposable Chromium Auth.");

  test("signed synthetic upload stays private from direct Storage calls", async ({
    browser, baseURL, request,
  }) => {
    test.setTimeout(120_000);
    const origin = loopbackOrigin(baseURL);
    const db = localService();
    const api = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!api?.startsWith("http://127.0.0.1:") || !anonKey)
      throw new Error("Disposable Storage endpoint required");
    const email = `gate2-storage-${randomUUID()}@example.test`;
    const context = await browser.newContext({ baseURL: origin });
    try {
      const page = await context.newPage();
      await page.goto("/r/signup");
      await page.getByLabel("Email address").fill(email);
      await page.getByRole("checkbox", { name: /18 or older/ }).check();
      await page.getByRole("button", { name: "Email me a sign-in link" }).click();
      const link = await deliveredEmail(page, email, origin,
        "/api/respondent/auth/callback");
      await page.goto(link.href);
      await expect(page.getByRole("heading", { name: "You’re signed in" }))
        .toBeVisible();
      const users = await db.auth.admin.listUsers();
      const owner = users.data?.users.find((candidate) => candidate.email === email);
      if (!owner) throw new Error("Synthetic owner missing");
      const profile = await db.from("respondents").select("id")
        .eq("auth_user_id", owner.id).single();
      if (!profile.data) throw new Error("Synthetic profile missing");
      const org = await db.from("organizations").insert({ name: "Storage fixture" })
        .select("id").single();
      const reviewer = await db.auth.admin.createUser({
        email: `gate2-storage-reviewer-${randomUUID()}@example.test`,
        email_confirm: true,
      });
      if (!org.data || !reviewer.data.user) throw new Error("Synthetic tenant missing");
      const researcher = await db.from("researchers").insert({
        auth_user_id: reviewer.data.user.id,
        organization_id: org.data.id,
        terms_version: "synthetic-test", terms_accepted_at: new Date().toISOString(),
      }).select("id").single();
      if (!researcher.data) throw new Error("Synthetic researcher missing");
      const study = await db.from("studies").insert({
        organization_id: org.data.id, title: "Private Storage fixture",
        state: "fielding", target_completes: 10, length_minutes: 10,
        deadline_at: new Date(Date.now() + 86_400_000).toISOString(),
      }).select("id").single();
      if (!study.data) throw new Error("Synthetic study missing");
      const guide = await db.from("guide_questions").insert({
        study_id: study.data.id, position: 1,
        text: "Describe your fictional experience.",
      });
      expect(guide.error).toBeNull();
      const criterion = await db.from("criteria").insert({
        study_id: study.data.id, kind: "must", attribute_key: "test",
        operator: "eq", value_json: true,
        text: "Fictional criterion this year",
      }).select("id").single();
      if (!criterion.data) throw new Error("Synthetic criterion missing");
      const rule = await db.from("gate2_screening_rules").insert({
        study_id: study.data.id, criterion_id: criterion.data.id,
        version: 1, criterion_kind: "must",
        criterion_text: "Fictional criterion this year",
        timeframe_text: "this year", question: "Fictional question?",
        approved_by: researcher.data.id,
        approved_at: new Date(Date.now() - 1_000).toISOString(),
      }).select("id").single();
      if (!rule.data) throw new Error("Synthetic rule missing");
      const offer = await db.from("invites").insert({
        study_id: study.data.id, respondent_id: profile.data.id,
        state: "screening", reward_cents: 100,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }).select("id").single();
      if (!offer.data) throw new Error("Synthetic offer missing");
      const consents = await db.from("consents").insert(
        ["retention", "recording", "transcription_vendor"].map((purpose) => ({
          respondent_id: profile.data.id, study_id: study.data.id,
          purpose, granted: true, text_version: "synthetic-storage-v1",
        })));
      expect(consents.error).toBeNull();

      await page.goto(`/r/screening/${offer.data.id}`);
      await expect(page.getByText("Fictional question?")).toBeVisible();
      const reserved = await page.evaluate(async ({ inviteId, ruleId, bytes }) => {
        const response = await fetch(`/api/respondent/screening/${inviteId}/audio`, {
          method: "POST", credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ruleId, ruleVersion: 1, bytes, mime: "audio/webm" }),
        });
        return { status: response.status, body: await response.json() };
      }, { inviteId: offer.data.id, ruleId: rule.data.id, bytes: media.length });
      expect(reserved.status, JSON.stringify(reserved.body)).toBe(200);
      const lease = reserved.body as {
        audioObjectId: string; expiresAt: string; uploadUrl: string };
      expect(Date.parse(lease.expiresAt)).toBeGreaterThan(Date.now());
      expect(Date.parse(lease.expiresAt)).toBeLessThanOrEqual(Date.now() + 600_000);
      const path = `screening/${offer.data.id}/${lease.audioObjectId}`;
      const signedUrl = new URL(lease.uploadUrl, api).toString();
      const signed = await request.put(signedUrl, {
        data: media, headers: { "content-type": "audio/webm" },
      });
      expect(signed.ok()).toBe(true);
      const stored = await db.storage.from(bucket).download(path);
      expect(stored.error).toBeNull();
      expect(Buffer.from(await stored.data!.arrayBuffer())).toEqual(media);
      const reused = await request.put(signedUrl, {
        data: replacement, headers: { "content-type": "audio/webm" },
      });
      expect(reused.ok()).toBe(false);

      const direct = `${api}/storage/v1/object/${bucket}/${path}`;
      const publicUrl = `${api}/storage/v1/object/public/${bucket}/${path}`;
      const list = `${api}/storage/v1/object/list/${bucket}`;
      const anonHeaders = { apikey: anonKey };
      expect((await request.get(publicUrl)).ok()).toBe(false);
      expect((await request.get(direct, { headers: anonHeaders })).ok()).toBe(false);
      const anonymousList = await request.post(list, {
        headers: anonHeaders, data: { prefix: `screening/${offer.data.id}` },
      });
      expect(await anonymousList.text()).not.toContain(lease.audioObjectId);
      expect((await request.post(direct, { headers: {
        ...anonHeaders, "content-type": "audio/webm" }, data: replacement })).ok())
        .toBe(false);
      expect((await request.put(direct, { headers: {
        ...anonHeaders, "content-type": "audio/webm" }, data: replacement })).ok())
        .toBe(false);

      const ownerPassword = `Synthetic-${randomUUID()}!`;
      const updatedOwner = await db.auth.admin.updateUserById(owner.id, {
        password: ownerPassword,
      });
      expect(updatedOwner.error).toBeNull();
      const ownerClient = createClient(api, anonKey);
      const ownerSignIn = await ownerClient.auth.signInWithPassword({
        email, password: ownerPassword,
      });
      if (!ownerSignIn.data.session) throw new Error("Synthetic owner token missing");
      const ownerHeaders = { apikey: anonKey,
        Authorization: `Bearer ${ownerSignIn.data.session.access_token}` };
      expect((await request.get(direct, { headers: ownerHeaders })).ok()).toBe(false);
      const ownerList = await request.post(list, {
        headers: ownerHeaders, data: { prefix: `screening/${offer.data.id}` },
      });
      expect(await ownerList.text()).not.toContain(lease.audioObjectId);
      expect((await request.put(direct, { headers: {
        ...ownerHeaders, "content-type": "audio/webm" }, data: replacement })).ok())
        .toBe(false);

      const outsiderEmail = `gate2-storage-outsider-${randomUUID()}@example.test`;
      const outsiderPassword = `Synthetic-${randomUUID()}!`;
      const outsider = await db.auth.admin.createUser({
        email: outsiderEmail, password: outsiderPassword, email_confirm: true,
      });
      if (!outsider.data.user) throw new Error("Synthetic outsider missing");
      const otherOrg = await db.from("organizations").insert({
        name: "Other Storage tenant" }).select("id").single();
      if (!otherOrg.data) throw new Error("Synthetic other tenant missing");
      const otherResearcher = await db.from("researchers").insert({
        auth_user_id: outsider.data.user.id,
        organization_id: otherOrg.data.id,
        terms_version: "synthetic-test", terms_accepted_at: new Date().toISOString(),
      });
      expect(otherResearcher.error).toBeNull();
      const otherClient = createClient(api, anonKey);
      const signedIn = await otherClient.auth.signInWithPassword({
        email: outsiderEmail, password: outsiderPassword,
      });
      if (!signedIn.data.session) throw new Error("Synthetic outsider token missing");
      const outsiderHeaders = { apikey: anonKey,
        Authorization: `Bearer ${signedIn.data.session.access_token}` };
      expect((await request.get(direct, { headers: outsiderHeaders })).ok()).toBe(false);
      const outsiderList = await request.post(list, {
        headers: outsiderHeaders, data: { prefix: `screening/${offer.data.id}` },
      });
      expect(await outsiderList.text()).not.toContain(lease.audioObjectId);
      expect((await request.put(direct, { headers: {
        ...outsiderHeaders, "content-type": "audio/webm" },
        data: replacement })).ok()).toBe(false);

      for (const sameTenantResearcher of [true, false]) {
        const otherEmail = `gate2-storage-other-${randomUUID()}@example.test`;
        const otherPassword = `Synthetic-${randomUUID()}!`;
        const other = await db.auth.admin.createUser({
          email: otherEmail, password: otherPassword, email_confirm: true,
        });
        if (!other.data.user) throw new Error("Synthetic other account missing");
        if (sameTenantResearcher) {
          const sameTenant = await db.from("researchers").insert({
            auth_user_id: other.data.user.id,
            organization_id: org.data.id,
            terms_version: "synthetic-test",
            terms_accepted_at: new Date().toISOString(),
          });
          expect(sameTenant.error).toBeNull();
        } else {
          const otherRespondent = await db.from("respondents").insert({
            auth_user_id: other.data.user.id,
            age_attested_at: new Date().toISOString(),
          });
          expect(otherRespondent.error).toBeNull();
        }
        const otherSession = await createClient(api, anonKey).auth.signInWithPassword({
          email: otherEmail, password: otherPassword,
        });
        if (!otherSession.data.session) throw new Error("Other account token missing");
        const otherHeaders = { apikey: anonKey,
          Authorization: `Bearer ${otherSession.data.session.access_token}` };
        expect((await request.get(direct, { headers: otherHeaders })).ok()).toBe(false);
        const otherList = await request.post(list, {
          headers: otherHeaders,
          data: { prefix: `screening/${offer.data.id}` },
        });
        expect(await otherList.text()).not.toContain(lease.audioObjectId);
        expect((await request.post(direct, { headers: {
          ...otherHeaders, "content-type": "audio/webm" },
          data: replacement })).ok()).toBe(false);
        expect((await request.put(direct, { headers: {
          ...otherHeaders, "content-type": "audio/webm" },
          data: replacement })).ok()).toBe(false);
      }
      const unchanged = await db.storage.from(bucket).download(path);
      expect(Buffer.from(await unchanged.data!.arrayBuffer())).toEqual(media);

      const withdrawn = await db.from("consents").insert({
        respondent_id: profile.data.id, study_id: study.data.id,
        purpose: "recording", granted: false,
        text_version: "synthetic-storage-v1",
      });
      expect(withdrawn.error).toBeNull();
      const confirmationStatus = await page.evaluate(async ({ inviteId, audioObjectId }) => {
        const response = await fetch(`/api/respondent/screening/${inviteId}/audio`, {
          method: "PUT", credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ audioObjectId, durationMs: 1000 }),
        });
        return response.status;
      }, { inviteId: offer.data.id, audioObjectId: lease.audioObjectId });
      expect(confirmationStatus).toBeGreaterThanOrEqual(400);
      expect((await request.get(direct, { headers: ownerHeaders })).ok()).toBe(false);
    } finally {
      await context.close();
    }
  });
});
