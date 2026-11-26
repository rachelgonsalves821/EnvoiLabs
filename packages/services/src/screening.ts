import { ScreeningInterpretationV1Schema, ScreeningRuleV1Schema,
  type ScreeningDecisionV1, type ScreeningRuleV1 } from "@envoi-labs/contracts";

export type ScreeningAnswer = { id: string; inviteId: string; studyId: string; ruleId: string;
  ruleVersion: number; text: string; kind: "text" | "voice";
  transcriptionConsentVersion: string | null; transcriptionReceiptId?: string | null;
  idempotencyKey: string };
export type ScreeningSubmission = Omit<ScreeningAnswer, "id"> & { respondentId: string };
export type ScreeningOutcome = ScreeningDecisionV1 & { answerId: string;
  interpretation: "supported" | "contradicted" | "unclear" | null;
  span: { startChar: number; endChar: number } | null };

export type ScreeningPorts = {
  getApprovedRule(ruleId: string, studyId: string, version: number): Promise<ScreeningRuleV1 | null>;
  // Return the stored private row on exact replay; reject conflicting keys.
  storeAnswer(answer: ScreeningSubmission): Promise<ScreeningAnswer>;
  getDecision(answerId: string): Promise<ScreeningOutcome | null>;
  interpret(rule: ScreeningRuleV1, answer: ScreeningAnswer): Promise<unknown>;
  // Gate 3's semantic validator must confirm that the cited answer span
  // actually supports the interpretation; range checks alone are insufficient.
  evidenceSupports(rule: ScreeningRuleV1, answer: ScreeningAnswer,
    result: "supported" | "contradicted", span: { startChar: number; endChar: number }): Promise<boolean>;
  // One database transaction stores the decision and, after checking caps,
  // transitions the invite when every approved question qualifies.
  commitDecision(decision: ScreeningOutcome): Promise<ScreeningOutcome | null>;
};

function resultFor(rule: ScreeningRuleV1, answerId: string,
  interpretation: ScreeningOutcome["interpretation"], span: ScreeningOutcome["span"],
  action: ScreeningDecisionV1["action"]): ScreeningOutcome {
  const confirmedFact = action === "qualify" || action === "screen_out"
    ? interpretation === "supported" : null;
  return { answerId, ruleId: rule.id, ruleVersion: rule.version,
    interpretation, span, action, confirmedFact } as ScreeningOutcome;
}

export async function screenSubmittedAnswer(ports: ScreeningPorts, submitted: ScreeningSubmission):
  Promise<ScreeningOutcome | null> {
  if (!submitted.text.trim() || !submitted.idempotencyKey.trim() ||
      (submitted.kind === "voice" && (!submitted.transcriptionConsentVersion?.trim() ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
          .test(submitted.transcriptionReceiptId ?? "")))) return null;
  const rule = ScreeningRuleV1Schema.safeParse(await ports.getApprovedRule(
    submitted.ruleId, submitted.studyId, submitted.ruleVersion));
  if (!rule.success || rule.data.studyId !== submitted.studyId ||
      rule.data.version !== submitted.ruleVersion) return null;
  let answer: ScreeningAnswer;
  try {
    answer = await ports.storeAnswer(submitted);
  } catch { return null; }
  if (answer.inviteId !== submitted.inviteId || answer.studyId !== submitted.studyId ||
      answer.ruleId !== rule.data.id || answer.ruleVersion !== rule.data.version ||
      answer.text !== submitted.text || answer.kind !== submitted.kind ||
      answer.transcriptionConsentVersion !== submitted.transcriptionConsentVersion ||
      (submitted.kind === "voice" &&
        answer.transcriptionReceiptId !== submitted.transcriptionReceiptId) ||
      answer.idempotencyKey !== submitted.idempotencyKey) return null;
  const prior = await ports.getDecision(answer.id);
  if (prior) return prior;

  let raw: unknown;
  try { raw = await ports.interpret(rule.data, answer); }
  catch { raw = null; }
  const parsed = ScreeningInterpretationV1Schema.safeParse(raw);
  let decision: ScreeningOutcome;
  if (!parsed.success) {
    decision = resultFor(rule.data, answer.id, null, null, raw === null ? "clarify" : "review");
  } else {
    const { result, span } = parsed.data;
    const codepoints = Array.from(answer.text);
    if (result === "unclear" || !span || span.endChar > codepoints.length ||
        !codepoints.slice(span.startChar, span.endChar).join("").trim()) {
      decision = resultFor(rule.data, answer.id, result, span, "clarify");
    } else if (!(await ports.evidenceSupports(rule.data, answer, result, span).catch(() => false))) {
      decision = resultFor(rule.data, answer.id, result, span, "review");
    } else {
      const excluded = (rule.data.criterionKind === "must" && result === "contradicted") ||
        (rule.data.criterionKind === "exclude" && result === "supported");
      decision = resultFor(rule.data, answer.id, result, span, excluded ? "screen_out" : "qualify");
    }
  }
  return ports.commitDecision(decision);
}
