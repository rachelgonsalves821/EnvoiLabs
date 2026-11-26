/** Only the current Gate 1 qualified redaction may become model input. */
export type QualifiedScreeningSource = {
  studyId: string; answerId: string; ruleId: string; ruleVersion: number;
  criterionText: string; question: string; redactedSourceVersion: string;
  redactionPolicyDigest: string; answerText: string;
};

type Database = { rpc(name: string, args: Record<string, unknown>):
  PromiseLike<{ data: unknown; error: unknown }> };
type Request = { studyId: string; answerId: string; ruleId: string;
  ruleVersion: number; providerModel: string; promptVersion: string;
  promptDigest: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
const keys = ["answerId", "answerText", "criterionText", "question",
  "redactedSourceVersion", "redactionPolicyDigest", "ruleId", "ruleVersion",
  "studyId"];

export async function readGate2QualifiedScreeningSource(db: Database,
  request: Request): Promise<QualifiedScreeningSource | null> {
  if (!request || !uuid.test(request.studyId) || !uuid.test(request.answerId) ||
      !uuid.test(request.ruleId) || !Number.isSafeInteger(request.ruleVersion) ||
      request.ruleVersion < 1 || !request.providerModel?.trim() ||
      !request.promptVersion?.trim() || !digest.test(request.promptDigest)) return null;
  try {
    const { data, error } = await db.rpc("current_gate2_screening_model_source", {
      requested_study_id: request.studyId, requested_answer_id: request.answerId,
      requested_rule_id: request.ruleId,
      requested_rule_version: request.ruleVersion,
      requested_provider_model: request.providerModel,
      requested_prompt_version: request.promptVersion,
      requested_prompt_digest: request.promptDigest,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
    const row = data as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== keys.join(",") ||
        row.studyId !== request.studyId || row.answerId !== request.answerId ||
        row.ruleId !== request.ruleId || row.ruleVersion !== request.ruleVersion ||
        !uuid.test(String(row.redactedSourceVersion)) ||
        !digest.test(String(row.redactionPolicyDigest)) ||
        typeof row.criterionText !== "string" || !row.criterionText.trim() ||
        typeof row.question !== "string" || !row.question.trim() ||
        typeof row.answerText !== "string" || !row.answerText.trim()) return null;
    return row as QualifiedScreeningSource;
  } catch { return null; }
}
