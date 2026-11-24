import { z } from "zod";
import { cents, exampleDate, exampleId, exampleRow, id, positive, row, text, timestamp, withExample } from "./contract.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const exampleDigest = "a".repeat(64);

/** Additive quote version. V1 remains readable until its consumers migrate. */
export const QuoteV2Schema = withExample(z.strictObject({
  ...row,
  studyId: id,
  briefVersion: positive,
  guideDigest: digest,
  pricingConfigId: id,
  pricingConfigVersion: positive,
  currency: z.literal("usd"),
  totalCents: cents,
  incentiveCentsPerComplete: cents,
  lineItems: z.array(z.strictObject({
    label: z.literal("Core questions"),
    coreQuestionCount: positive.min(4).max(10),
    respondentCount: positive,
    unitPriceCents: positive,
    amountCents: cents,
  })).length(1),
  feasibility: z.strictObject({ expectedCompletes: z.int().nonnegative(), hours: positive }),
}).superRefine((quote, ctx) => {
  const line = quote.lineItems[0];
  if (line && (line.coreQuestionCount * line.respondentCount * line.unitPriceCents !== quote.totalCents ||
    line.amountCents !== quote.totalCents)) {
    ctx.addIssue({ code: "custom", message: "Quote amount must match its line item.", path: ["totalCents"] });
  }
}), {
  ...exampleRow, studyId: exampleId, briefVersion: 1, guideDigest: exampleDigest,
  pricingConfigId: exampleId, pricingConfigVersion: 1, currency: "usd", totalCents: 500,
  incentiveCentsPerComplete: 200,
  lineItems: [{ label: "Core questions", coreQuestionCount: 5, respondentCount: 1,
    unitPriceCents: 100, amountCents: 500 }],
  feasibility: { expectedCompletes: 1, hours: 24 },
});

/** Payment identity is bound to one frozen quote and its pricing version. */
export const PaymentV2Schema = withExample(z.strictObject({
  ...row, studyId: id, quoteId: id, pricingConfigVersion: positive,
  currency: z.literal("usd"), amountCents: positive, refundedCents: cents,
  providerCheckoutId: text, status: z.enum(["pending", "paid", "refunded", "failed"]),
}).refine((payment) => payment.refundedCents <= payment.amountCents, { path: ["refundedCents"] }), {
  ...exampleRow, studyId: exampleId, quoteId: exampleId, pricingConfigVersion: 1,
  currency: "usd", amountCents: 500, refundedCents: 0,
  providerCheckoutId: "cs_test_1", status: "pending",
});

export const ScreeningRuleV1Schema = withExample(z.strictObject({
  id, studyId: id, criterionId: id, version: positive,
  criterionKind: z.enum(["must", "nice", "exclude"]),
  criterionText: text, timeframeText: text, question: text,
  approvedAt: timestamp,
}), { id: exampleId, studyId: exampleId, criterionId: exampleId, version: 1,
  criterionKind: "must", criterionText: "Ordered food after 10pm in the last 30 days",
  timeframeText: "last 30 days", question: "Did you order food after 10pm in the last 30 days?",
  approvedAt: exampleDate });

/** Model evidence stays private; the Platform rule determines qualification. */
export const ScreeningInterpretationV1Schema = withExample(z.strictObject({
  result: z.enum(["supported", "contradicted", "unclear"]),
  span: z.strictObject({ startChar: z.int().nonnegative(), endChar: positive }).nullable(),
}).superRefine(({ result, span }, ctx) => {
  if (result !== "unclear" && !span) ctx.addIssue({ code: "custom", message: "A decision needs a source span.", path: ["span"] });
  if (span && span.endChar <= span.startChar) ctx.addIssue({ code: "custom", message: "The span must be forward.", path: ["span", "endChar"] });
}), { result: "supported", span: { startChar: 0, endChar: 17 } });

export const ScreeningDecisionV1Schema = withExample(z.discriminatedUnion("action", [
  z.strictObject({ action: z.enum(["qualify", "screen_out"]), ruleId: id, ruleVersion: positive,
    confirmedFact: z.boolean() }),
  z.strictObject({ action: z.enum(["clarify", "review"]), ruleId: id, ruleVersion: positive,
    confirmedFact: z.null() }),
]), { action: "qualify", ruleId: exampleId, ruleVersion: 1, confirmedFact: true });

export type QuoteV2 = z.infer<typeof QuoteV2Schema>;
export type PaymentV2 = z.infer<typeof PaymentV2Schema>;
export type ScreeningRuleV1 = z.infer<typeof ScreeningRuleV1Schema>;
export type ScreeningInterpretationV1 = z.infer<typeof ScreeningInterpretationV1Schema>;
export type ScreeningDecisionV1 = z.infer<typeof ScreeningDecisionV1Schema>;
