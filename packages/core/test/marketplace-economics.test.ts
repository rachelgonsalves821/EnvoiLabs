import { describe, expect, it } from "vitest";
import { priceMarketplaceStudy, referralVesting, respondentAnsweredQuestionReward,
  unfilledSlotRefund } from "../src/index.js";

describe("revised marketplace economics", () => {
  it("prices only core questions for at least ten respondents", () => {
    expect(priceMarketplaceStudy({ coreQuestionCount: 5, respondentCount: 10,
      unitPriceCents: 200, rewardPerQuestionCents: 100 })).toMatchObject({
      totalCents: 10_000, incentiveCentsPerComplete: 500,
      lineItems: [{ coreQuestionCount: 5, respondentCount: 10,
        unitPriceCents: 200, amountCents: 10_000 }],
    });
    expect(() => priceMarketplaceStudy({ coreQuestionCount: 5, respondentCount: 9,
      unitPriceCents: 200, rewardPerQuestionCents: 100 })).toThrow(RangeError);
    expect(() => priceMarketplaceStudy({ coreQuestionCount: 5, respondentCount: 10,
      unitPriceCents: 100, rewardPerQuestionCents: 40 })).toThrow(RangeError);
  });

  it("refunds one of twelve frozen slots after eleven completes, exactly once", () => {
    const frozen = { coreQuestionCount: 5, respondentCount: 12,
      unitPriceCents: 200, totalCents: 12_000, pricingConfigVersion: 101 };
    expect(unfilledSlotRefund(frozen, 11, 0)).toEqual({
      missingSlots: 1, newRefundSlots: 1, refundCents: 1000,
      pricingConfigVersion: 101 });
    expect(unfilledSlotRefund(frozen, 11, 1)).toEqual({
      missingSlots: 1, newRefundSlots: 0, refundCents: 0,
      pricingConfigVersion: 101 });
    expect(() => unfilledSlotRefund(frozen, 11, 2)).toThrow(RangeError);
    // A later active price cannot affect the refund of this paid quote.
    expect(unfilledSlotRefund(frozen, 11, 0).refundCents).toBe(1000);
  });

  it("rewards approved answered core questions, excluding probes and duplicate retries", () => {
    expect(respondentAnsweredQuestionReward(["q1", "q2", "q3", "q4", "q5"],
      ["q1", "q2", "q2", "probe-1"])).toBe(200);
    expect(respondentAnsweredQuestionReward(["q1", "q2", "q3", "q4", "q5"],
      ["q1", "q2", "q3", "q4", "q5"])).toBe(500);
  });

  it("vests $5 only after five distinct verified friends", () => {
    const referrerId = "owner";
    const referrals = ["a", "b", "c", "d", "e"].map((respondentId) =>
      ({ respondentId, referrerId, verifiedProfile: true }));
    expect(referralVesting(referrerId, referrals.slice(0, 4), false))
      .toEqual({ verifiedFriends: 4, bonusCents: 0 });
    expect(referralVesting(referrerId, [...referrals, referrals[0]!,
      { respondentId: referrerId, referrerId, verifiedProfile: true },
      { respondentId: "unverified", referrerId, verifiedProfile: false },
      { respondentId: "other", referrerId: "someone-else", verifiedProfile: true }], false))
      .toEqual({ verifiedFriends: 5, bonusCents: 500 });
    expect(referralVesting(referrerId, referrals, true))
      .toEqual({ verifiedFriends: 5, bonusCents: 0 });
  });
});
