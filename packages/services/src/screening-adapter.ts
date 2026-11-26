import { ScreeningDecisionV1Schema, type ScreeningRuleV1 } from "@envoi-labs/contracts";
import type { ScreeningAnswer, ScreeningOutcome, ScreeningPorts,
  ScreeningSubmission } from "./screening.js";

type Database = { rpc(name: string, args: Record<string, unknown>):
  PromiseLike<{ data: unknown; error: { code: string } | null }> };
type EvidenceInput = { studyId: string; answerId: string; ruleId: string;
  ruleVersion: number; criterionText: string; question: string; answerText: string;
  result: "supported" | "contradicted";
  span: { startChar: number; endChar: number } };
type Agent3 = {
  interpret(rule: ScreeningRuleV1, answer: ScreeningAnswer): Promise<unknown>;
  evidenceSupports(input: EvidenceInput): Promise<boolean>;
};

function outcome(value: unknown): ScreeningOutcome | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const decision = ScreeningDecisionV1Schema.safeParse({ action: record.action,
    ruleId: record.ruleId, ruleVersion: record.ruleVersion,
    confirmedFact: record.confirmedFact });
  if (!decision.success || typeof record.answerId !== "string" ||
      !(record.interpretation === null || record.interpretation === "supported" ||
        record.interpretation === "contradicted" || record.interpretation === "unclear")) return null;
  const span = record.span;
  if (span !== null && (!(typeof span === "object") || Array.isArray(span) ||
      !Number.isSafeInteger((span as Record<string, unknown>).startChar) ||
      !Number.isSafeInteger((span as Record<string, unknown>).endChar))) return null;
  return { ...decision.data, answerId: record.answerId,
    interpretation: record.interpretation, span: span as ScreeningOutcome["span"] };
}

export function createScreeningAdapter(db: Database, agent3: Agent3): ScreeningPorts {
  return {
    async getApprovedRule(ruleId, studyId, version) {
      const { data, error } = await db.rpc("get_gate2_screening_rule", {
        requested_rule_id: ruleId, requested_study_id: studyId,
        requested_version: version });
      if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
      const record = data as Record<string, unknown>;
      const approvedAt = typeof record.approvedAt === "string"
        ? new Date(record.approvedAt) : new Date(NaN);
      if (!Number.isFinite(approvedAt.getTime())) return null;
      return { ...record, approvedAt: approvedAt.toISOString() } as ScreeningRuleV1;
    },
    async storeAnswer(answer: ScreeningSubmission) {
      const { data, error } = answer.kind === "voice"
        ? await db.rpc("store_gate2_screening_transcribed_answer", {
          requested_receipt_id: answer.transcriptionReceiptId,
          requested_key: answer.idempotencyKey,
        })
        : await db.rpc("store_gate2_screening_answer", {
        requested_invite_id: answer.inviteId,
        requested_respondent_id: answer.respondentId,
        requested_study_id: answer.studyId,
        requested_rule_id: answer.ruleId,
        requested_version: answer.ruleVersion,
        requested_kind: answer.kind,
        requested_text: answer.text,
        requested_consent_version: answer.transcriptionConsentVersion,
        requested_key: answer.idempotencyKey,
      });
      if (error || !data) throw new Error("Screening answer was not stored");
      return data as ScreeningAnswer;
    },
    async getDecision(answerId) {
      const { data, error } = await db.rpc("get_gate2_screening_decision", {
        requested_answer_id: answerId });
      if (error) throw new Error("Screening decision lookup failed");
      if (data === null) return null;
      const parsed = outcome(data);
      if (!parsed) throw new Error("Invalid stored screening decision");
      return parsed;
    },
    interpret: agent3.interpret,
    evidenceSupports(rule, answer, result, span) {
      return agent3.evidenceSupports({ studyId: rule.studyId, answerId: answer.id,
        ruleId: rule.id, ruleVersion: rule.version,
        criterionText: rule.criterionText,
        question: rule.question, answerText: answer.text, result, span });
    },
    async commitDecision(decision) {
      const { data, error } = await db.rpc("commit_gate2_screening_decision", {
        requested_answer_id: decision.answerId,
        requested_rule_id: decision.ruleId,
        requested_version: decision.ruleVersion,
        requested_interpretation: decision.interpretation,
        requested_start: decision.span?.startChar ?? null,
        requested_end: decision.span?.endChar ?? null,
        requested_action: decision.action,
        requested_confirmed: decision.confirmedFact,
      });
      return error ? null : outcome(data);
    },
  };
}
