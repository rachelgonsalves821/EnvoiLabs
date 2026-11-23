import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createGroqTranscriber, createOpenAITranscriber, runGate1AnswerJob, withTranscriptionFallback } from "@envoi-labs/ai";
import { createLocalGate1Redactor } from "./gate1-local-redactor.mjs";

const audioBucket = "gate1-interview-audio";
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const hash = /^[a-f\d]{64}$/;
const supportedMime = new Set(["audio/webm", "audio/mp4", "audio/wav", "audio/ogg"]);
const completionStates = new Set(["published", "private", "stale", "alreadyCompleted"]);

function validClaim(data) {
  if (!data || !uuid.test(data.answerId) || !uuid.test(data.leaseId)) return false;
  if (data.kind === "text") return typeof data.rawText === "string" && data.rawText.trim() !== "";
  const audio = data.audio;
  if (data.kind !== "voice" || !audio || typeof audio.storagePath !== "string") return false;
  const path = audio.storagePath.split("/");
  return path.length === 2 && path.every((part) => uuid.test(part)) && hash.test(audio.sha256) &&
    supportedMime.has(audio.mime) && Number.isSafeInteger(audio.bytes) && audio.bytes > 0 && audio.bytes <= 20 * 1024 * 1024 &&
    (audio.durationMs === null || (Number.isSafeInteger(audio.durationMs) && audio.durationMs > 0));
}

export function createGate1DatabasePorts(client, {
  answerId = null, createTranscriber, redact = null, policyDigest = null, qualificationDigest = null,
}) {
  if (policyDigest !== null && (typeof policyDigest !== "string" || !hash.test(policyDigest))) {
    throw new Error("Configure a valid Gate 1 redaction policy digest.");
  }
  if (qualificationDigest !== null && (typeof qualificationDigest !== "string" || !hash.test(qualificationDigest))) {
    throw new Error("Configure a valid Gate 1 redaction qualification digest.");
  }
  let transcriber = null;
  function leaseArgs({ answerId, leaseId }) {
    return { supplied_answer_id: answerId, supplied_lease_id: leaseId };
  }
  async function rpc(name, args) {
    const result = await client.rpc(name, args);
    if (result.error) throw new Error(`Gate 1 worker failed during ${name}.`);
    return result.data;
  }
  return {
    async claim() {
      const claim = await rpc("claim_gate1_answer_job", { supplied_answer_id: answerId });
      if (claim === null) return null;
      if (!validClaim(claim) || (answerId !== null && claim.answerId !== answerId)) {
        throw new Error("Gate 1 worker received an invalid claim.");
      }
      if (claim.kind === "voice") transcriber = createTranscriber(claim.audio.durationMs);
      return claim;
    },
    get transcriber() { return transcriber; },
    async validate(lease) {
      return await rpc("validate_gate1_answer_job", leaseArgs(lease)) === true;
    },
    async readRecording(path) {
      const { data, error } = await client.storage.from(audioBucket).download(path);
      if (error || !data || data.size > 20 * 1024 * 1024) throw new Error("Gate 1 recording could not be read.");
      return new Uint8Array(await data.arrayBuffer());
    },
    redact,
    async complete(lease, { transcription, redactedText }) {
      const outcome = await rpc("complete_gate1_answer_job", {
        ...leaseArgs(lease),
        ...(transcription ? {
          supplied_raw_text: transcription.text, supplied_provider: transcription.provider,
          supplied_model: transcription.model, supplied_latency_ms: transcription.latencyMs,
          supplied_cost_micros: transcription.costMicros,
        } : {}),
        ...(redactedText && policyDigest && qualificationDigest ? {
          supplied_redacted_text: redactedText, supplied_redaction_passed: true, supplied_policy_digest: policyDigest,
          supplied_qualification_digest: qualificationDigest,
        } : {}),
      });
      if (!completionStates.has(outcome?.status)) throw new Error("Gate 1 worker received an invalid completion.");
      return outcome.status;
    },
    async retry(lease) {
      await rpc("retry_gate1_answer_job", leaseArgs(lease));
    },
  };
}

function configuredTranscriber(env, durationMs) {
  const openaiKey = env.OPENAI_API_KEY?.trim();
  const groqKey = env.GROQ_API_KEY?.trim();
  const estimate = (usageSeconds, minimum, microsPerSecond) =>
    Math.ceil(Math.max(usageSeconds ?? (durationMs ?? 180_000) / 1000, minimum) * microsPerSecond);
  const openai = openaiKey ? createOpenAITranscriber({
    apiKey: openaiKey, model: "gpt-transcribe", timeoutMs: 20_000,
    costMicros: ({ durationSeconds }) => estimate(durationSeconds, 0, 75),
  }) : null;
  const groq = groqKey ? createGroqTranscriber({
    apiKey: groqKey, model: "whisper-large-v3-turbo", timeoutMs: 20_000,
    costMicros: ({ durationSeconds }) => estimate(durationSeconds, 10, 40_000 / 3600),
  }) : null;
  return openai && groq ? withTranscriptionFallback(openai, groq) : openai ?? groq;
}

export async function runConfiguredGate1AnswerJob(env, answerId = null, redactor = null) {
  if (answerId !== null && !uuid.test(answerId)) throw new Error("Supply a valid Gate 1 answer ID.");
  const url = new URL(env.SUPABASE_URL);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.origin !== env.SUPABASE_URL || (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
      !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) throw new Error("Configure the trusted Gate 1 database connection.");
  const client = createClient(url.origin, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return runGate1AnswerJob(createGate1DatabasePorts(client, {
    ...redactor, answerId, createTranscriber: (durationMs) => configuredTranscriber(env, durationMs),
  }));
}

async function main(args, env) {
  const next = args.length === 1 && args[0] === "--next";
  const selected = args.length === 2 && args[0] === "--answer" && uuid.test(args[1]);
  if (!next && !selected) throw new Error("Use --next or supply one Gate 1 answer ID using --answer.");
  const redactor = env.ENVOI_GATE1_REDACTION_EXECUTABLE ? createLocalGate1Redactor({
    executable: env.ENVOI_GATE1_REDACTION_EXECUTABLE,
    script: env.ENVOI_GATE1_REDACTION_SCRIPT,
    manifest: env.ENVOI_GATE1_REDACTION_MANIFEST,
    manifestSha256: env.ENVOI_GATE1_REDACTION_MANIFEST_SHA256,
    report: env.ENVOI_GATE1_REDACTION_REPORT,
    reportSha256: env.ENVOI_GATE1_REDACTION_REPORT_SHA256,
    policyDigest: env.ENVOI_GATE1_REDACTION_POLICY_DIGEST,
    contextModel: env.ENVOI_GATE1_REDACTION_CONTEXT_MODEL,
    casingModel: env.ENVOI_GATE1_REDACTION_CASING_MODEL,
    pythonPath: env.ENVOI_GATE1_REDACTION_PYTHONPATH,
  }) : null;
  const status = await runConfiguredGate1AnswerJob(env, next ? null : args[1], redactor);
  console.log(JSON.stringify({ status }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2), process.env);
  } catch {
    console.error(JSON.stringify({ status: "failed", message: "Gate 1 worker could not complete the requested job." }));
    process.exitCode = 1;
  }
}
