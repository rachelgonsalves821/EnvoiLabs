import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { ProviderError, runGate1AnswerJob, withTranscriptionFallback } from "@envoi-labs/ai";
import { drainPrivateGate1Answers } from "../platform/gate1-private-answers.ts";
import { createGate1DatabasePorts, runConfiguredGate1AnswerJob } from "./gate1-worker.mjs";

const endpoint = "http://127.0.0.1:54321";
const bucket = "gate1-interview-audio";
const purposes = ["recording", "transcription_vendor", "retention", "researcher_access"];

function clientFor(key) {
  assert.ok(key, "Missing disposable key");
  return createClient(endpoint, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { async fetch(input, options) {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      assert.equal(url.origin, endpoint, "Integration may only contact the disposable stack");
      return fetch(input, { ...options, redirect: "error" });
    } },
  });
}

function checked(result, action) {
  if (result.error) throw new Error(`${action} failed (${result.error.code ?? result.error.status ?? "unknown"}).`);
  return result.data;
}

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const character of secret.toUpperCase().replace(/=+$/, "")) {
    const index = alphabet.indexOf(character);
    assert.ok(index >= 0, "Invalid fixture MFA secret");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const value = (digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

test("leased worker retries, withholds withdrawn voice and publishes only the qualified fixture", async () => {
  assert.equal(process.env.ENVOI_TEST_LOCAL_SUPABASE, "1");
  assert.equal(process.env.SUPABASE_URL, endpoint);
  const service = clientFor(process.env.SUPABASE_SERVICE_ROLE_KEY);

  async function identity(label) {
    const email = `${label}-${randomUUID()}@example.test`;
    const password = randomUUID();
    const { user } = checked(await service.auth.admin.createUser({ email, password, email_confirm: true }), `Create ${label}`);
    const browser = clientFor(process.env.SUPABASE_PUBLISHABLE_KEY);
    checked(await browser.auth.signInWithPassword({ email, password }), `Sign in ${label}`);
    return { id: user.id, browser };
  }

  const respondent = await identity("respondent");
  const researcher = await identity("researcher");
  const markedAt = new Date().toISOString();
  const organizationId = randomUUID();
  const respondentId = randomUUID();
  const studyId = randomUUID();
  const inviteId = randomUUID();
  const sessionId = randomUUID();
  const questionId = randomUUID();
  const answerId = randomUUID();
  const seedRows = [
    ["organizations", { id: organizationId, name: "Synthetic tenant" }],
    ["researchers", { auth_user_id: researcher.id, organization_id: organizationId, terms_version: "synthetic", terms_accepted_at: markedAt }],
    ["respondents", { id: respondentId, auth_user_id: respondent.id, age_attested_at: markedAt }],
    ["studies", { id: studyId, organization_id: organizationId, title: "Synthetic study", state: "fielding", target_completes: 1, length_minutes: 4 }],
    ["guide_questions", { id: questionId, study_id: studyId, position: 1, text: "What did you order?" }],
    ["invites", { id: inviteId, study_id: studyId, respondent_id: respondentId, state: "accepted", reward_cents: 100,
      expires_at: new Date(Date.now() + 3_600_000).toISOString() }],
    ["sessions", { id: sessionId, invite_id: inviteId, study_id: studyId, state: "in_progress" }],
  ];
  for (const [table, row] of seedRows) checked(await service.from(table).insert(row), `Seed ${table}`);

  async function allowVendor(granted) {
    const decisions = purposes.map((purpose) => ({ purpose, granted: purpose !== "transcription_vendor" || granted, textVersion: "gate1-preview-v1" }));
    assert.equal(checked(await respondent.browser.rpc("save_gate1_consent", { decisions }), "Set fixture consent"), true);
  }
  await allowVendor(true);

  const { id: factorId, totp: { secret } } = checked(await researcher.browser.auth.mfa.enroll({ factorType: "totp" }), "Enroll fixture MFA");
  checked(await researcher.browser.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) }), "Confirm fixture MFA");
  assert.equal(checked(await researcher.browser.auth.mfa.getAuthenticatorAssuranceLevel(), "Inspect fixture MFA").currentLevel, "aal2");

  const fixture = await readFile(new URL("../../../../packages/testing/fixtures/audio/01-delivery.webm", import.meta.url));
  const { audioObjectId } = checked(await respondent.browser.rpc("reserve_gate1_audio", {
    supplied_session_id: sessionId, supplied_question_id: questionId, supplied_bytes: fixture.length, supplied_mime: "audio/webm",
  }), "Reserve synthetic recording");
  checked(await service.storage.from(bucket).upload(`${sessionId}/${audioObjectId}`, fixture, { contentType: "audio/webm" }), "Upload synthetic recording");
  checked(await service.rpc("confirm_gate1_voice_answer", {
    supplied_owner_id: respondentId, supplied_session_id: sessionId, supplied_question_id: questionId,
    supplied_audio_id: audioObjectId, supplied_answer_id: answerId, supplied_duration_ms: 3093,
    supplied_sha256: "\\x" + createHash("sha256").update(fixture).digest("hex"),
  }), "Confirm synthetic recording");

  const leases = [];
  const database = {
    storage: service.storage,
    async rpc(name, args) {
      const response = await service.rpc(name, name === "retry_gate1_answer_job" ? { ...args, supplied_delay_seconds: 0 } : args);
      if (name === "claim_gate1_answer_job" && response.data) leases.push(response.data.leaseId);
      return response;
    },
  };
  const raw = "My fictional contact is Mira Example. I ordered soup.";
  const redacted = "I ordered soup.";
  let fallbackCalls = 0;
  let redactionCalls = 0;
  async function run(fallback, qualify = true) {
    return runGate1AnswerJob(createGate1DatabasePorts(database, {
      answerId,
      createTranscriber(durationMs) {
        assert.equal(durationMs, 3093);
        return withTranscriptionFallback({ async transcribe() { throw new ProviderError("openai", "timeout"); } }, {
          async transcribe(input) {
            fallbackCalls++;
            assert.equal(input.mediaType, "audio/webm");
            assert.deepEqual(Buffer.from(input.audio), fixture);
            await fallback();
            return { text: raw, provider: "synthetic-fallback", model: "fixture", latencyMs: 8, costMicros: 0 };
          },
        });
      },
      redact: qualify ? async (text) => {
        redactionCalls++;
        return text === raw ? redacted : null;
      } : null,
    }));
  }
  async function projection() {
    return checked(await researcher.browser.from("transcripts").select("redacted_text").eq("answer_id", answerId), "Read scoped transcript");
  }

  let competingState;
  assert.equal(await run(async () => {
    competingState = await run(() => { assert.fail("A second worker cannot process a current lease"); });
    throw new ProviderError("groq", "transport");
  }), "retry");
  assert.equal(competingState, "idle");
  assert.deepEqual(await projection(), []);
  assert.equal(await run(() => allowVendor(false)), "stale");
  assert.deepEqual(await projection(), []);
  assert.equal(redactionCalls, 0);
  assert.deepEqual(checked(await service.from("transcripts").select("id").eq("answer_id", answerId), "Check no stale result"), []);
  assert.notEqual(leases[0], leases[1]);

  await allowVendor(true);
  assert.equal(checked(await service.rpc("retry_gate1_answer_job", {
    supplied_answer_id: answerId, supplied_lease_id: leases[1], supplied_delay_seconds: 0,
  }), "Schedule stale lease for reprocessing"), true);
  assert.equal(await run(() => {}, false), "private");
  assert.deepEqual(await projection(), []);
  assert.equal(checked(await service.rpc("requeue_gate1_answer_job", { supplied_answer_id: answerId }), "Requeue private output"), true);
  assert.equal(await run(() => {}), "published");
  assert.equal(await run(() => { assert.fail("Completed work must stay idle"); }), "idle");
  assert.equal(new Set(leases).size, 4);
  assert.equal(fallbackCalls, 4);
  assert.equal(redactionCalls, 1);
  assert.deepEqual(await projection(), [{ redacted_text: redacted }]);
  assert.deepEqual(checked(await service.from("transcripts").select("provider,model,cost_micros").eq("answer_id", answerId), "Check fixture metadata"), [
    { provider: "synthetic-fallback", model: "fixture", cost_micros: 0 },
  ]);
  assert.ok((await researcher.browser.schema("pii").from("transcript_raw").select("raw_text")).error, "Private schema remains closed to researchers");

  const typedQuestionId = randomUUID();
  const typedAnswerId = randomUUID();
  checked(await service.from("guide_questions").insert({
    id: typedQuestionId, study_id: studyId, position: 2, text: "What would you order next?",
  }), "Add typed fixture question");
  const typedInput = {
    supplied_session_id: sessionId, supplied_question_id: typedQuestionId,
    supplied_answer_id: typedAnswerId, supplied_text: "I would order berries.",
  };
  for (let confirmation = 0; confirmation < 2; confirmation++) {
    assert.equal(checked(await respondent.browser.rpc("record_gate1_text_answer", typedInput), "Confirm queued text").answer.id, typedAnswerId);
  }

  const runNext = () => runConfiguredGate1AnswerJob({
    SUPABASE_URL: endpoint, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }, typedAnswerId); // This disposable stack also holds pending jobs from the browser scenarios.
  await assert.rejects(drainPrivateGate1Answers(async () => {
    throw new Error("Simulated scheduler failure after answer commit.");
  }, runNext), /Simulated scheduler failure after answer commit/);
  assert.deepEqual(checked(await researcher.browser.from("transcripts").select("redacted_text")
    .eq("answer_id", typedAnswerId), "Check undispatched text is private"), []);

  let privateCompletions = 0;
  const runStep = (_id, operation) => operation();
  const runDrain = () => drainPrivateGate1Answers(runStep, async () => {
    const status = await runNext();
    if (status === "private") privateCompletions++;
    return status;
  });
  const recovered = await Promise.all([runDrain(), runDrain()]);
  assert.deepEqual(recovered.map(({ examined }) => examined).sort(), [0, 1]);
  assert.equal(privateCompletions, 1);
  assert.deepEqual(await runDrain(), { examined: 0 });
  assert.deepEqual(checked(await service.from("transcripts").select("redacted_text")
    .eq("answer_id", typedAnswerId), "Check exactly one private text transcript"), [{ redacted_text: null }]);
  assert.deepEqual(checked(await researcher.browser.from("transcripts").select("redacted_text")
    .eq("answer_id", typedAnswerId), "Check recovered text remains private"), []);
});
