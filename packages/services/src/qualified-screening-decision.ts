import { ScreeningDecisionV1Schema, ScreeningInterpretationV1Schema,
  ScreeningRuleV1Schema } from "@envoi-labs/contracts";
import { createQualifiedScreeningBridge } from "./qualified-screening-bridge.js";
import { readGate2QualifiedScreeningSource } from "./qualified-screening-source.js";
import type { ScreeningOutcome } from "./screening.js";

type Database = Parameters<typeof createQualifiedScreeningBridge>[0];
type Model = Parameters<typeof createQualifiedScreeningBridge>[1];
type Request = Parameters<ReturnType<typeof createQualifiedScreeningBridge>["interpret"]>[0];

function parseOutcome(value: unknown, request: Request,
  sourceVersion?: string): ScreeningOutcome | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const parsed = ScreeningDecisionV1Schema.safeParse({ action: row.action,
    ruleId: row.ruleId, ruleVersion: row.ruleVersion,
    confirmedFact: row.confirmedFact });
  if (!parsed.success || row.answerId !== request.answerId ||
      row.ruleId !== request.ruleId || row.ruleVersion !== request.ruleVersion ||
      (sourceVersion && row.redactedSourceVersion !== sourceVersion) ||
      !([null, "supported", "contradicted", "unclear"] as unknown[])
        .includes(row.interpretation)) return null;
  const span = row.span;
  if (span !== null && (!span || typeof span !== "object" ||
      Array.isArray(span) ||
      !Number.isSafeInteger((span as Record<string, unknown>).startChar) ||
      !Number.isSafeInteger((span as Record<string, unknown>).endChar))) return null;
  return { ...parsed.data, answerId: request.answerId,
    interpretation: row.interpretation as ScreeningOutcome["interpretation"],
    span: span as ScreeningOutcome["span"] };
}

/** The only Platform path that turns a qualified model result into an offer
 * transition. The database repeats authority checks under its row locks. */
export async function decideQualifiedScreeningAnswer(db: Database, model: Model,
  request: Request): Promise<ScreeningOutcome | null> {
  try {
    const prior = await db.rpc("get_gate2_current_qualified_screening_decision", {
      requested_answer_id: request.answerId,
      requested_provider_model: request.providerModel,
      requested_prompt_version: request.promptVersion,
      requested_prompt_digest: request.promptDigest,
    });
    if (prior.error) return null;
    if (prior.data !== null) return parseOutcome(prior.data, request);
    const anyPrior = await db.rpc("get_gate2_screening_decision", {
      requested_answer_id: request.answerId });
    if (anyPrior.error || anyPrior.data !== null) return null;
    const ruleResult = await db.rpc("get_gate2_screening_rule", {
      requested_rule_id: request.ruleId,
      requested_study_id: request.studyId,
      requested_version: request.ruleVersion,
    });
    const rawRule = ruleResult.data;
    if (!rawRule || typeof rawRule !== "object" || Array.isArray(rawRule)) return null;
    const ruleRow = rawRule as Record<string, unknown>;
    if (typeof ruleRow.approvedAt !== "string") return null;
    const approvedAt = new Date(ruleRow.approvedAt);
    if (!Number.isFinite(approvedAt.getTime())) return null;
    const rule = ScreeningRuleV1Schema.safeParse({ ...ruleRow,
      approvedAt: approvedAt.toISOString() });
    if (ruleResult.error || !rule.success || rule.data.id !== request.ruleId ||
        rule.data.studyId !== request.studyId ||
        rule.data.version !== request.ruleVersion) return null;
    const approvedSource = await readGate2QualifiedScreeningSource(db, request);
    if (!approvedSource || approvedSource.criterionText !== rule.data.criterionText ||
        approvedSource.question !== rule.data.question) return null;
    const bridge = createQualifiedScreeningBridge(db, model);
    const interpreted = await bridge.interpret(request);
    if (!interpreted || interpreted.source.criterionText !== rule.data.criterionText ||
        interpreted.source.question !== rule.data.question ||
        interpreted.source.redactedSourceVersion !== approvedSource.redactedSourceVersion ||
        interpreted.source.answerText !== approvedSource.answerText) return null;
    const { source } = interpreted;
    const parsed = ScreeningInterpretationV1Schema.safeParse(interpreted.interpretation);
    let interpretation: ScreeningOutcome["interpretation"] = null;
    let span: ScreeningOutcome["span"] = null;
    let action: ScreeningOutcome["action"] = "clarify";
    if (parsed.success) {
      interpretation = parsed.data.result;
      span = parsed.data.span;
      if (interpretation !== "unclear" && span) {
        const supported = await bridge.evidenceSupports(request, source,
          interpretation, span);
        if (!supported) action = "review";
        else action = (rule.data.criterionKind === "must" &&
          interpretation === "contradicted") ||
          (rule.data.criterionKind === "exclude" &&
            interpretation === "supported") ? "screen_out" : "qualify";
      }
    }
    const confirmedFact = action === "qualify" || action === "screen_out"
      ? interpretation === "supported" : null;
    const committed = await db.rpc("commit_gate2_qualified_screening_decision", {
      requested_answer_id: request.answerId, requested_rule_id: request.ruleId,
      requested_version: request.ruleVersion,
      requested_interpretation: interpretation,
      requested_start: span?.startChar ?? null,
      requested_end: span?.endChar ?? null,
      requested_action: action, requested_confirmed: confirmedFact,
      requested_source_version: source.redactedSourceVersion,
      requested_redaction_policy_digest: source.redactionPolicyDigest,
      requested_provider_model: request.providerModel,
      requested_prompt_version: request.promptVersion,
      requested_prompt_digest: request.promptDigest,
    });
    return committed.error ? null : parseOutcome(committed.data, request,
      source.redactedSourceVersion);
  } catch { return null; }
}
