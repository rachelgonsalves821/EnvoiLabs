import { describe, expect, it } from "vitest";
import { parseCurrentEarnings } from "./earnings";

const valid = { currency: "usd", earnedCents: 300, deliveredCents: 0,
  sessions: [{ sessionId: "session", studyId: "study", earnedCents: 300,
    payoutStatus: "pending" }],
  referral: { verifiedProfiles: 4, vestedBonusCents: 0,
    payoutStatus: "not_vested", payoutId: null, deliveredAt: null } };

describe("respondent Earnings snapshot", () => {
  it("accepts a current private money snapshot", () => {
    expect(parseCurrentEarnings(valid)).toEqual(valid);
  });
  it("fails closed on an invalid amount or payout state", () => {
    expect(parseCurrentEarnings({ ...valid, deliveredCents: 400 })).toBeNull();
    expect(parseCurrentEarnings({ ...valid, sessions: [
      { ...valid.sessions[0], payoutStatus: "paid" }] })).toBeNull();
    expect(parseCurrentEarnings({ ...valid, referral: null })).toBeNull();
    expect(parseCurrentEarnings({ ...valid, referral: {
      ...valid.referral, payoutStatus: "delivered" } })).toBeNull();
  });
  it("keeps one batch receipt attached to each earned session", () => {
    const payoutId = "11111111-1111-4111-8111-111111111111";
    const batchId = "22222222-2222-4222-8222-222222222222";
    const delivered = { ...valid, deliveredCents: 300, sessions: [{
      ...valid.sessions[0], payoutStatus: "delivered",
      payoutId, batchId, deliveredAt: "2026-11-25T02:00:00Z" }] };
    expect(parseCurrentEarnings(delivered)).toEqual(delivered);
    expect(parseCurrentEarnings({ ...delivered, sessions: [{
      ...delivered.sessions[0], batchId: "other" }] })).toBeNull();
    expect(parseCurrentEarnings({ ...delivered, sessions: [{
      ...delivered.sessions[0], deliveredAt: "not-a-date" }] })).toBeNull();
  });
});
