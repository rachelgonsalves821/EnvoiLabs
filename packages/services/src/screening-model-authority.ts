/** Structural match for Gate 3's ScreeningModelUsePort, kept at the Platform boundary. */
export type ScreeningAuthorizationAttempt = {
  purpose: "ai_screening"; providerModel: string; promptVersion: string;
  promptDigest: string; studyId: string; answerId: string;
  ruleId: string; ruleVersion: number; sourceDigest: string;
  redactedSourceVersion: string; redactionPolicyDigest: string;
};
type Database = { rpc(name: string, args: Record<string, unknown>):
  PromiseLike<{ data: unknown; error: unknown }> };
const hexDigest = /^[a-f0-9]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sourceKeys = ["answerId", "answerText", "criterionText", "question",
  "redactedSourceVersion", "redactionPolicyDigest", "ruleId", "ruleVersion", "studyId"];

/** Each call re-reads current consent, policy, rule, answer and offer state. */
export function createGate2ScreeningModelUsePort(db: Database) {
  return {
    async authorize(attempt: ScreeningAuthorizationAttempt): Promise<boolean> {
      if (!attempt || attempt.purpose !== "ai_screening" ||
        !uuid.test(attempt.studyId) || !uuid.test(attempt.answerId) ||
        !uuid.test(attempt.ruleId) || !Number.isSafeInteger(attempt.ruleVersion) ||
        attempt.ruleVersion < 1 || !attempt.providerModel?.trim() ||
        !uuid.test(attempt.redactedSourceVersion) ||
        !hexDigest.test(attempt.redactionPolicyDigest) ||
        !attempt.promptVersion?.trim() || !hexDigest.test(attempt.promptDigest) ||
        !hexDigest.test(attempt.sourceDigest)) return false;
      try {
        const { data, error } = await db.rpc("current_gate2_screening_model_source", {
          requested_study_id: attempt.studyId,
          requested_answer_id: attempt.answerId,
          requested_rule_id: attempt.ruleId,
          requested_rule_version: attempt.ruleVersion,
          requested_provider_model: attempt.providerModel,
          requested_prompt_version: attempt.promptVersion,
          requested_prompt_digest: attempt.promptDigest,
        });
        if (error || !data || typeof data !== "object" || Array.isArray(data)) return false;
        const row = data as Record<string, unknown>;
        if (Object.keys(row).sort().join(",") !== sourceKeys.join(",") ||
          row.studyId !== attempt.studyId || row.answerId !== attempt.answerId ||
          row.ruleId !== attempt.ruleId || row.ruleVersion !== attempt.ruleVersion ||
          row.redactedSourceVersion !== attempt.redactedSourceVersion ||
          row.redactionPolicyDigest !== attempt.redactionPolicyDigest ||
          typeof row.criterionText !== "string" || !row.criterionText.trim() ||
          typeof row.question !== "string" || !row.question.trim() ||
          typeof row.answerText !== "string" || !row.answerText.trim()) return false;
        const source = { studyId: row.studyId, answerId: row.answerId,
          ruleId: row.ruleId, ruleVersion: row.ruleVersion,
          criterionText: row.criterionText, question: row.question,
          redactedSourceVersion: row.redactedSourceVersion,
          redactionPolicyDigest: row.redactionPolicyDigest,
          answerText: row.answerText };
        const bytes = await crypto.subtle.digest("SHA-256",
          new TextEncoder().encode(JSON.stringify(source)));
        const digest = Array.from(new Uint8Array(bytes),
          (byte) => byte.toString(16).padStart(2, "0")).join("");
        return digest === attempt.sourceDigest;
      } catch { return false; }
    },
  };
}
