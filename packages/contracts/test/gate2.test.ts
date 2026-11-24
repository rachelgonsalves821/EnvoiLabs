import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { PaymentV2Schema, QuoteV2Schema, QuoteV3Schema, ScreeningDecisionV1Schema,
  ScreeningInterpretationV1Schema, ScreeningRuleV1Schema } from "../src/index.js";

function example(schema: z.ZodType) {
  const examples = schema.meta()?.["examples"];
  if (!Array.isArray(examples)) throw new Error("Contract example missing.");
  return examples[0];
}

describe("Gate 2 additive contracts", () => {
  it("keeps old quotes readable but requires ten respondents and $1 reward in V3", () => {
    const oldQuote = QuoteV2Schema.parse(example(QuoteV2Schema));
    const marketplace = QuoteV3Schema.parse(example(QuoteV3Schema));
    expect(QuoteV3Schema.safeParse(oldQuote).success).toBe(false);
    expect(QuoteV3Schema.safeParse(marketplace).success).toBe(true);
    expect(QuoteV3Schema.safeParse({ ...marketplace,
      incentiveCentsPerComplete: 400 }).success).toBe(false);
    expect(QuoteV3Schema.safeParse({ ...marketplace, lineItems: [{
      ...marketplace.lineItems[0], unitPriceCents: 100,
      amountCents: 5000 }], totalCents: 5000 }).success).toBe(false);
    expect(QuoteV3Schema.safeParse({ ...marketplace, lineItems: [{
      ...marketplace.lineItems[0], respondentCount: 9,
      amountCents: 9000 }], totalCents: 9000 }).success).toBe(false);
  });
  it.each([QuoteV2Schema, PaymentV2Schema, ScreeningRuleV1Schema,
    ScreeningInterpretationV1Schema, ScreeningDecisionV1Schema])("round trips its example", (schema) => {
    const value = example(schema);
    expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });

  it("rejects a quote whose line item or price is inconsistent", () => {
    const quote = QuoteV2Schema.parse(example(QuoteV2Schema));
    expect(QuoteV2Schema.safeParse({ ...quote, totalCents: 600 }).success).toBe(false);
    expect(QuoteV2Schema.safeParse({ ...quote, currency: "cad" }).success).toBe(false);
    expect(QuoteV2Schema.safeParse({ ...quote, guideDigest: "unpinned" }).success).toBe(false);
  });

  it("requires source evidence for a model conclusion", () => {
    expect(ScreeningInterpretationV1Schema.safeParse({ result: "supported", span: null }).success).toBe(false);
    expect(ScreeningInterpretationV1Schema.safeParse({ result: "contradicted", span: { startChar: 4, endChar: 4 } }).success).toBe(false);
    expect(ScreeningInterpretationV1Schema.safeParse({ result: "unclear", span: null }).success).toBe(true);
  });

  it("keeps payment and screening outcomes tied to immutable source IDs", () => {
    const payment = PaymentV2Schema.parse(example(PaymentV2Schema));
    expect(PaymentV2Schema.safeParse({ ...payment, quoteId: "missing" }).success).toBe(false);
    expect(PaymentV2Schema.safeParse({ ...payment, refundedCents: 501 }).success).toBe(false);
    expect(ScreeningDecisionV1Schema.safeParse({ action: "screen_out", ruleId: payment.id,
      ruleVersion: 1, confirmedFact: null }).success).toBe(false);
  });
});
