import type { InviteState } from "@envoi-labs/contracts";
import { transitionInvite } from "./state/invite.js";
import type { TransitionContext } from "./state/transition.js";

export type ScreeningEvidence = "supported" | "contradicted" | "unclear";
export type ScreeningCriterionKind = "must" | "nice" | "exclude";

export interface ScreeningInterpretation {
  result: ScreeningEvidence;
  span: { startChar: number; endChar: number } | null;
}

export interface ScreeningInput {
  ruleVersion: number;
  criterionKind: ScreeningCriterionKind;
  answerText: string;
  interpretation: ScreeningInterpretation | null;
  timedOut: boolean;
  hasParticipationCapacity: boolean;
}

export type ScreeningDecision =
  | { action: "qualify"; ruleVersion: number; confirmedFact: boolean }
  | { action: "screen_out"; ruleVersion: number; confirmedFact: boolean }
  | { action: "clarify" | "review"; ruleVersion: number; confirmedFact: null };

/** Interpretation is evidence only; the versioned rule makes the decision. */
export function decideScreening(input: ScreeningInput): ScreeningDecision {
  if (!Number.isSafeInteger(input.ruleVersion) || input.ruleVersion <= 0) {
    throw new Error("Screening rule version must be a positive safe integer.");
  }
  const { interpretation, answerText } = input;
  if (input.criterionKind !== "must" && input.criterionKind !== "nice" && input.criterionKind !== "exclude") {
    return { action: "review", ruleVersion: input.ruleVersion, confirmedFact: null };
  }
  if (!input.hasParticipationCapacity) return { action: "review", ruleVersion: input.ruleVersion, confirmedFact: null };
  if (input.timedOut || !interpretation || !answerText.trim()) {
    return { action: "clarify", ruleVersion: input.ruleVersion, confirmedFact: null };
  }
  if (interpretation.result !== "supported" && interpretation.result !== "contradicted") {
    return { action: "clarify", ruleVersion: input.ruleVersion, confirmedFact: null };
  }
  const span = interpretation.span;
  if (!span || !Number.isSafeInteger(span.startChar) || !Number.isSafeInteger(span.endChar) ||
    span.startChar < 0 || span.endChar <= span.startChar || span.endChar > answerText.length ||
    !answerText.slice(span.startChar, span.endChar).trim()) {
    return { action: "clarify", ruleVersion: input.ruleVersion, confirmedFact: null };
  }
  const confirmedFact = interpretation.result === "supported";
  const excluded = input.criterionKind === "must" ? !confirmedFact :
    input.criterionKind === "exclude" && confirmedFact;
  return { action: excluded ? "screen_out" : "qualify", ruleVersion: input.ruleVersion, confirmedFact };
}
/** Does not change an invite for clarification or review. Recheck caps at delivery. */
export function transitionScreenedInvite(
  state: InviteState,
  decision: ScreeningDecision,
  hasParticipationCapacity: boolean,
  context: TransitionContext & { expiresAt: Date },
) {
  if (state !== "screening") throw new Error("A screening decision requires a screening invite.");
  if (!hasParticipationCapacity || decision.action === "clarify" || decision.action === "review") return null;
  return transitionInvite(state, decision.action === "qualify" ? "send" : "screen_out", context);
}
