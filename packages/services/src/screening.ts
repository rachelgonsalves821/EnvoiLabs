import { ScreeningInterpretationV1Schema, ScreeningRuleV1Schema,
  type ScreeningDecisionV1, type ScreeningRuleV1 } from "@envoi-labs/contracts";

type Answer = { id: string; inviteId: string; studyId: string; ruleId: string;
  ruleVersion: number; text: string; kind: "text" | "voice";
  transcriptionConsentVersion: string | null; idempotencyKey: string };
type Submission = Omit<Answer, "id">;
type Decision = ScreeningDecisionV1 & { answerId: string;
  interpretation: "supported" | "contradicted" | "unclear" | null;
  span: { startChar: number; endChar: number } | null };

type ScreeningPorts = {
  getApprovedRule(ruleId: string): Promise<ScreeningRuleV1 | null>;
  // Both writes must return the stored row on exact replay and reject a
  // conflicting idempotency key. Answers remain in the private schema.
  storeAnswer(answer: Submission): Promise<Answer>;
  getDecision(answerId: string): Promise<Decision | null>;
  interpret(rule: ScreeningRuleV1, answer: Answer): Promise<unknown>;
  // Gate 3's semantic validator must confirm that the cited answer span
  // actually supports the interpretation; range checks alone are insufficient.
  evidenceSupports(rule: ScreeningRuleV1, answer: Answer,
    result: "supported" | "contradicted", span: { startChar: number; endChar: number }): Promise<boolean>;
  recordDecision(decision: Decision): Promise<Decision>;
  // Transactionally recheck participation caps and invite state at delivery;
  // exact replay after a successful transition must return true.
  transitionInvite(decision: Decision): Promise<boolean>;
};

async function deliverDecision(ports: ScreeningPorts, decision: Decision): Promise<Decision | null> {
  if ((decision.action === "qualify" || decision.action === "screen_out") &&
      !(await ports.transitionInvite(decision))) return null;
  return decision;
}

function resultFor(rule: ScreeningRuleV1, answerId: string,
  interpretation: Decision["interpretation"], span: Decision["span"],
  action: ScreeningDecisionV1["action"]): Decision {
  const confirmedFact = action === "qualify" || action === "screen_out"
    ? interpretation === "supported" : null;
  return { answerId, ruleId: rule.id, ruleVersion: rule.version,
    interpretation, span, action, confirmedFact } as Decision;
}

export async function screenSubmittedAnswer(ports: ScreeningPorts, submitted: Submission):
  Promise<Decision | null> {
  if (!submitted.text.trim() || !submitted.idempotencyKey.trim() ||
      (submitted.kind === "voice" && !submitted.transcriptionConsentVersion?.trim())) return null;
  const rule = ScreeningRuleV1Schema.safeParse(await ports.getApprovedRule(submitted.ruleId));
  if (!rule.success || rule.data.studyId !== submitted.studyId ||
      rule.data.version !== submitted.ruleVersion) return null;
  let answer: Answer;
  try {
    answer = await ports.storeAnswer(submitted);
  } catch { return null; }
  if (answer.inviteId !== submitted.inviteId || answer.studyId !== submitted.studyId ||
      answer.ruleId !== rule.data.id || answer.ruleVersion !== rule.data.version ||
      answer.text !== submitted.text || answer.kind !== submitted.kind ||
      answer.transcriptionConsentVersion !== submitted.transcriptionConsentVersion ||
      answer.idempotencyKey !== submitted.idempotencyKey) return null;
  const prior = await ports.getDecision(answer.id);
  if (prior) return deliverDecision(ports, prior);

  let raw: unknown;
  try { raw = await ports.interpret(rule.data, answer); }
  catch { raw = null; }
  const parsed = ScreeningInterpretationV1Schema.safeParse(raw);
  let decision: Decision;
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
  const stored = await ports.recordDecision(decision);
  return deliverDecision(ports, stored);
}
