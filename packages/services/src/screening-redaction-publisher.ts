type Database = { rpc(name: string, args: Record<string, unknown>):
  PromiseLike<{ data: unknown; error: unknown }> };
type Redactor = { policyDigest: string; qualificationDigest: string;
  redact(rawText: string): Promise<string> };
type Request = { answerId: string; policyDigest: string;
  qualificationDigest: string; idempotencyKey: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[a-f0-9]{64}$/;

/** Private Gate 1 handoff. Its result contains no raw or redacted answer text. */
export async function publishGate2ScreeningRedaction(db: Database,
  redact: Redactor, request: Request): Promise<{ sourceVersion: string; qualified: boolean } | null> {
  if (!request || !uuid.test(request.answerId) ||
      !digest.test(request.policyDigest) || !digest.test(request.qualificationDigest) ||
      !redact || redact.policyDigest !== request.policyDigest ||
      redact.qualificationDigest !== request.qualificationDigest ||
      !/^gate2-redaction:[a-f0-9-]{36}$/.test(request.idempotencyKey)) return null;
  try {
    const input = await db.rpc("read_gate2_screening_redaction_input", {
      requested_answer_id: request.answerId,
      requested_policy_digest: request.policyDigest,
    });
    if (input.error || !input.data || typeof input.data !== "object" ||
        Array.isArray(input.data)) return null;
    const source = input.data as Record<string, unknown>;
    if (Object.keys(source).sort().join(",") !==
        "answerId,answerText,kind,policyDigest,qualificationDigest,rawAnswerDigest,studyId" ||
        source.answerId !== request.answerId ||
        !uuid.test(String(source.studyId)) ||
        source.policyDigest !== request.policyDigest ||
        source.qualificationDigest !== request.qualificationDigest ||
        (source.kind !== "text" && source.kind !== "voice") ||
        typeof source.answerText !== "string" || !source.answerText.trim() ||
        source.answerText.length > 2000) return null;
    const digestBytes = await crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(source.answerText));
    const rawDigest = Array.from(new Uint8Array(digestBytes),
      (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (source.rawAnswerDigest !== rawDigest) return null;
    let redactedText: string | null = null;
    try { redactedText = await redact.redact(source.answerText); }
    catch { /* Write a withheld source so an older redaction cannot fall back. */ }
    const passed = typeof redactedText === "string" && redactedText.trim() !== "" &&
      redactedText.length <= 2000;
    const result = await db.rpc("publish_gate2_screening_redacted_source", {
      requested_answer_id: request.answerId,
      requested_policy_digest: request.policyDigest,
      requested_raw_digest: rawDigest,
      requested_redacted_text: passed ? redactedText : null,
      requested_redaction_passed: passed,
      requested_key: request.idempotencyKey,
    });
    if (result.error || !result.data || typeof result.data !== "object" ||
        Array.isArray(result.data)) return null;
    const saved = result.data as Record<string, unknown>;
    return Object.keys(saved).sort().join(",") === "qualified,sourceVersion" &&
      uuid.test(String(saved.sourceVersion)) && saved.qualified === passed
      ? { sourceVersion: saved.sourceVersion as string, qualified: passed } : null;
  } catch { return null; }
}
