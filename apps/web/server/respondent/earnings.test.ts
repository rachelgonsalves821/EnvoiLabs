import { describe, expect, it } from "vitest";
import { parseCurrentEarnings } from "./earnings";

const valid = { currency: "usd", earnedCents: 300, deliveredCents: 0,
  sessions: [{ sessionId: "session", studyId: "study", earnedCents: 300,
    payoutStatus: "pending" }],
  referral: { verifiedProfiles: 4, vestedBonusCents: 0 } };

describe("respondent Earnings snapshot", () => {
  it("accepts a current private money snapshot", () => {
    expect(parseCurrentEarnings(valid)).toEqual(valid);
  });
  it("fails closed on an invalid amount or payout state", () => {
    expect(parseCurrentEarnings({ ...valid, deliveredCents: 400 })).toBeNull();
    expect(parseCurrentEarnings({ ...valid, sessions: [
      { ...valid.sessions[0], payoutStatus: "paid" }] })).toBeNull();
    expect(parseCurrentEarnings({ ...valid, referral: null })).toBeNull();
  });
});
