import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { runGate1AnswerJob } from "@envoi-labs/ai";
import { FakeTranscriber } from "../../../../packages/testing/dist/fakes/ai.js";
import { createGate1DatabasePorts } from "./gate1-worker.mjs";

const endpoint = "http://127.0.0.1:54321";
const bucket = "gate1-interview-audio";
const policyDigest = "a".repeat(64);
const fixtureDirectory = new URL("../../../../packages/testing/fixtures/audio/", import.meta.url);
const voiceProjections = new Map([
  ["01-delivery.webm", "I ordered soup on Tuesday because the store was closed."],
  ["02-price.m4a", "I would pay two dollars if the delivery arrived before my next class."],
  ["03-phone.webm", "I ordered a sandwich."],
  ["04-unclear.m4a", "I am not sure. I think it was sometime before lunch."],
  ["05-email.wav", "[Contact details removed.]"],
]);

function localClient(key) {
  assert.ok(key, "Missing disposable Supabase credential.");
  return createClient(endpoint, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { async fetch(input, options) {
      const address = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      assert.equal(address.origin, endpoint, "Worker integration may only contact disposable Supabase.");
      return fetch(input, { ...options, redirect: "error" });
    } },
  });
}

function checked(result, action) {
  if (result.error) throw new Error(`${action} failed (${result.error.code ?? result.error.status ?? "unknown"}).`);
  return result.data;
}

async function openSession(service, studyId) {
  const email = `format-respondent-${randomUUID()}@example.test`;
  const password = randomUUID();
  const { user } = checked(await service.auth.admin.createUser({ email, password, email_confirm: true }), "Seed fixture identity");
  const client = localClient(process.env.SUPABASE_PUBLISHABLE_KEY);
  checked(await client.auth.signInWithPassword({ email, password }), "Sign in fixture respondent");
  const respondentId = randomUUID();
  const sessionId = randomUUID();
  const inviteId = randomUUID();
  const rows = [
    ["respondents", { id: respondentId, auth_user_id: user.id, age_attested_at: new Date().toISOString() }],
    ["invites", { id: inviteId, study_id: studyId, respondent_id: respondentId, state: "accepted",
      reward_cents: 160, expires_at: new Date(Date.now() + 3_600_000).toISOString() }],
    ["sessions", { id: sessionId, study_id: studyId, invite_id: inviteId, state: "in_progress" }],
  ];
  for (const [table, row] of rows) checked(await service.from(table).insert(row), `Seed fixture ${table}`);

  async function consentToVoice(granted) {
    const decisions = [
      ["recording", granted], ["transcription_vendor", granted],
      ["retention", true], ["researcher_access", true],
    ].map(([purpose, allowed]) => ({ purpose, granted: allowed, textVersion: "gate1-preview-v1" }));
    assert.equal(checked(await client.rpc("save_gate1_consent", { decisions }), "Set fixture consent"), true);
  }
  await consentToVoice(true);
  return { respondentId, sessionId, client, consentToVoice };
}

test("IT-1.2 processes the five checked-in recordings and keeps typed intake independent of ASR", async () => {
  assert.equal(process.env.ENVOI_TEST_LOCAL_SUPABASE, "1");
  assert.equal(process.env.SUPABASE_URL, endpoint);
  const service = localClient(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { cases } = JSON.parse(await readFile(new URL("manifest.json", fixtureDirectory), "utf8"));
  assert.deepEqual(cases.map(({ file }) => file).sort(), [...voiceProjections.keys()].sort(),
    "All five reviewed recordings must be represented.");
  assert.deepEqual([...new Set(cases.map(({ mime }) => mime))].sort(), ["audio/mp4", "audio/wav", "audio/webm"]);
  const fake = new FakeTranscriber(new Map(cases.map(({ sha256, text }) => [sha256, text])));
  const organizationId = randomUUID();
  const studyId = randomUUID();
  const questionIds = Array.from({ length: 4 }, () => randomUUID());
  checked(await service.from("organizations").insert({ id: organizationId, name: "Fixture transcription formats" }), "Seed fixture tenant");
  checked(await service.from("studies").insert({ id: studyId, organization_id: organizationId,
    title: "Synthetic recording format study", state: "fielding", target_completes: 2, length_minutes: 4 }), "Seed fixture study");
  checked(await service.from("guide_questions").insert(questionIds.map((id, index) => ({
    id, study_id: studyId, position: index + 1, text: `Synthetic guide question ${index + 1}`,
  }))), "Seed four-question guide");
  const first = await openSession(service, studyId);
  const second = await openSession(service, studyId);

  async function projection(answerId) {
    return checked(await service.from("transcripts").select("provider,model,latency_ms,cost_micros,redacted_text")
      .eq("answer_id", answerId).maybeSingle(), "Read synthetic worker metadata");
  }

  for (const [index, fixture] of cases.entries()) {
    const { respondentId, sessionId, client } = index < 3 ? first : second;
    const questionId = questionIds[index < 3 ? index : index - 3];
    const redactedText = voiceProjections.get(fixture.file);
    const bytes = await readFile(new URL(fixture.file, fixtureDirectory));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.sha256);
    const answerId = randomUUID();
    const durationMs = Math.round(fixture.seconds * 1000);
    const { audioObjectId } = checked(await client.rpc("reserve_gate1_audio", {
      supplied_session_id: sessionId, supplied_question_id: questionId, supplied_bytes: bytes.length, supplied_mime: fixture.mime,
    }), "Reserve synthetic recording");
    checked(await service.storage.from(bucket).upload(`${sessionId}/${audioObjectId}`, bytes, { contentType: fixture.mime }), "Store private synthetic recording");
    checked(await service.rpc("confirm_gate1_voice_answer", {
      supplied_owner_id: respondentId, supplied_session_id: sessionId, supplied_question_id: questionId,
      supplied_audio_id: audioObjectId, supplied_answer_id: answerId, supplied_duration_ms: durationMs,
      supplied_sha256: "\\x" + fixture.sha256,
    }), "Confirm synthetic recording");
    assert.equal(await projection(answerId), null, "Unprocessed audio has no transcript row.");

    let primaryCalls = 0;
    const ports = createGate1DatabasePorts(service, {
      answerId,
      createTranscriber(leasedDuration) {
        assert.equal(leasedDuration, durationMs, fixture.file);
        return { async transcribe(request) {
          primaryCalls++;
          assert.equal(request.mediaType, fixture.mime, fixture.file);
          const output = await fake.transcribe(request);
          return { ...output, provider: "synthetic-primary", model: "fixture-v1", latencyMs: 20 + index, costMicros: index + 1 };
        } };
      },
      policyDigest,
      redact: async (text) => text === fixture.text ? redactedText : null,
    });
    assert.equal(await runGate1AnswerJob(ports), "published", fixture.file);
    assert.equal(primaryCalls, 1, fixture.file);
    assert.deepEqual(await projection(answerId), {
      provider: "synthetic-primary", model: "fixture-v1", latency_ms: 20 + index, cost_micros: index + 1,
      redacted_text: redactedText,
    }, fixture.file);
  }

  await second.consentToVoice(false);
  const suppliedSession = { supplied_session_id: second.sessionId, supplied_question_id: questionIds[2] };
  const denied = await second.client.rpc("reserve_gate1_audio", { ...suppliedSession, supplied_bytes: 1024, supplied_mime: "audio/webm" });
  assert.equal(denied.error?.code, "23514", "Voice reservation requires recording and vendor consent.");

  const typedId = randomUUID();
  const typedText = "My fictional email is typed@example.test. I chose pickup.";
  checked(await second.client.rpc("record_gate1_text_answer", {
    ...suppliedSession, supplied_answer_id: typedId, supplied_text: typedText,
  }), "Record synthetic typed answer without ASR consent");
  const typedMetadata = { provider: "typed", model: "none", latency_ms: 0, cost_micros: 0 };
  assert.deepEqual(await projection(typedId), { ...typedMetadata, redacted_text: null });
  let redactionCalls = 0;
  const typed = createGate1DatabasePorts(service, {
    answerId: typedId,
    createTranscriber: () => assert.fail("Typed intake must bypass speech recognition."),
    policyDigest,
    redact: async (text) => {
      redactionCalls++;
      return text === typedText ? "I chose pickup." : null;
    },
  });
  assert.equal(await runGate1AnswerJob(typed), "published");
  assert.equal(redactionCalls, 1, "Typed intake must use the same redaction step.");
  assert.deepEqual(await projection(typedId), { ...typedMetadata, redacted_text: "I chose pickup." });
});
