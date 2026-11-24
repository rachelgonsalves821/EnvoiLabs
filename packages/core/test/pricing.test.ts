import { describe, expect, it } from "vitest";
import { priceStudy } from "../src/index.js";

describe("study pricing", () => {
  it("bills only core questions and target respondents in integer cents", () => {
    expect(priceStudy({ coreQuestionCount: 5, respondentCount: 1,
      unitPriceCents: 100, incentivePerQuestionCents: 40 })).toEqual({
      totalCents: 500, incentiveCentsPerComplete: 200,
      lineItems: [{ label: "Core questions", coreQuestionCount: 5,
        respondentCount: 1, unitPriceCents: 100, amountCents: 500 }],
    });
  });

  it.each([0, 3, 11, 1.5, Number.MAX_SAFE_INTEGER])(
    "rejects invalid or unsafe core question count %s", (coreQuestionCount) => {
      expect(() => priceStudy({ coreQuestionCount, respondentCount: 20,
        unitPriceCents: 100, incentivePerQuestionCents: 40 })).toThrow(RangeError);
    });
  it("rejects unsafe total cents", () => {
    expect(() => priceStudy({ coreQuestionCount: 10, respondentCount: Number.MAX_SAFE_INTEGER,
      unitPriceCents: 100, incentivePerQuestionCents: 40 })).toThrow(RangeError);
    expect(() => priceStudy({ coreQuestionCount: 5, respondentCount: 1_000_000,
      unitPriceCents: 500, incentivePerQuestionCents: 40 })).toThrow(RangeError);
  });
});
