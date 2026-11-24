import { describe, expect, it } from "vitest";
import { decideScreening, priceStudy } from "../src/index.js";

const config = { version: 7, params: { unitPriceCents: 100, incentivePerQuestionCents: 40 } };
const coreQuestions = ["One?", "Two?", "Three?", "Four?", "Five?"];

describe("IT-2.3 versioned pricing", () => {
  it("prices core questions in integer cents and records the config version", () => {
    const quote = priceStudy({ coreQuestions, targetCompletes: 1 }, config);
    expect(quote).toEqual({
      pricingConfigVersion: 7, totalCents: 500, incentiveCentsPerComplete: 200,
      expectedMarginCents: 300,
      lineItems: [{ label: "Core questions", coreQuestionCount: 5, respondentCount: 1,
        unitPriceCents: 100, amountCents: 500 }],
    });
    expect(priceStudy({ coreQuestions, targetCompletes: 20 }, config).totalCents).toBe(10_000);
  });

  it("does not take probe or screener counts into the pricing input", () => {
    const base = priceStudy({ coreQuestions, targetCompletes: 1 }, config);
    expect(base.totalCents).toBe(500);
    expect(Object.keys(base.lineItems[0])).not.toContain("probes");
    expect(Object.keys(base.lineItems[0])).not.toContain("screeners");
  });

  it("rejects fractional, invalid, and overflowing money", () => {
    expect(() => priceStudy({ coreQuestions, targetCompletes: 1 },
      { ...config, params: { ...config.params, unitPriceCents: 0.5 } })).toThrow(/Unit price/);
    expect(() => priceStudy({ coreQuestions, targetCompletes: Number.MAX_SAFE_INTEGER }, config)).toThrow(/safe integer cents/);
    expect(() => priceStudy({ coreQuestions: ["blank", " ", "three", "four"], targetCompletes: 1 }, config)).toThrow(/nonblank/);
  });
});

describe("screening rule", () => {
  const answerText = "I ordered last week";
  const evidence = { result: "supported" as const, span: { startChar: 2, endChar: 19 } };
  const base = { ruleVersion: 3, criterionKind: "must" as const, answerText,
    interpretation: evidence, timedOut: false, hasParticipationCapacity: true };

  it("qualifies or excludes only on valid evidence and the criterion kind", () => {
    expect(decideScreening(base)).toEqual({ action: "qualify", ruleVersion: 3, confirmedFact: true });
    expect(decideScreening({ ...base, interpretation: { ...evidence, result: "contradicted" } }).action).toBe("screen_out");
    expect(decideScreening({ ...base, criterionKind: "exclude" }).action).toBe("screen_out");
    expect(decideScreening({ ...base, criterionKind: "exclude", interpretation: { ...evidence, result: "contradicted" } }).action).toBe("qualify");
    expect(decideScreening({ ...base, criterionKind: "nice", interpretation: { ...evidence, result: "contradicted" } }).action).toBe("qualify");
  });

  it("routes missing, ambiguous, timed out, and invalid evidence to clarification", () => {
    for (const change of [
      { interpretation: null },
      { interpretation: { result: "unclear" as const, span: null } },
      { interpretation: { ...evidence, span: { startChar: 0, endChar: 99 } } },
      { timedOut: true },
      { answerText: " " },
    ]) expect(decideScreening({ ...base, ...change }).action).toBe("clarify");
  });

  it("keeps participation caps authoritative", () => {
    expect(decideScreening({ ...base, hasParticipationCapacity: false }).action).toBe("review");
    expect(decideScreening({ ...base, criterionKind: "unknown" as "must" }).action).toBe("review");
  });
});
