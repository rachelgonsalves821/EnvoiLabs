import { describe, expect, it, vi } from "vitest";
import { issueReservedReferralPayout, PayoutReservationDenied } from "../src/payout";

const vestingId = "11111111-1111-4111-8111-111111111111";
const payoutId = "22222222-2222-4222-8222-222222222222";
const reserved = { id: payoutId, vestingId,
  respondentId: "33333333-3333-4333-8333-333333333333",
  recipientId: payoutId, productId: "sandbox_visa", amountCents: 500,
  state: "pending" as const, providerOrderId: null };
const order = { id: "ORDER-REFERRAL", eventId: "event-referral",
  recipientId: payoutId, productId: "sandbox_visa", amountCents: 500,
  status: "delivered" as const, observedAt: "2026-11-26T07:00:00Z" };

describe("TEST referral Visa settlement", () => {
  it("keeps a below-minimum vested bonus away from the provider", async () => {
    const db = { reserveReferralPayout: vi.fn().mockResolvedValue({ status: "below_minimum" }),
      recordOrder: vi.fn() };
    const provider = { getOrderByKey: vi.fn(), createOrder: vi.fn() };
    expect(await issueReservedReferralPayout(db, provider, vestingId))
      .toBe("below_minimum");
    expect(provider.getOrderByKey).not.toHaveBeenCalled();
    expect(provider.createOrder).not.toHaveBeenCalled();
  });
  it("reconciles one frozen $5 intent and never creates again after delivery", async () => {
    const db = { reserveReferralPayout: vi.fn().mockResolvedValueOnce(reserved)
      .mockResolvedValue({ ...reserved, state: "delivered", providerOrderId: order.id }),
      recordOrder: vi.fn().mockResolvedValue(undefined) };
    const provider = { getOrderByKey: vi.fn().mockResolvedValueOnce(null)
      .mockResolvedValueOnce(order), createOrder: vi.fn().mockResolvedValue(undefined) };
    expect(await issueReservedReferralPayout(db, provider, vestingId)).toBe("delivered");
    expect(await issueReservedReferralPayout(db, provider, vestingId)).toBe("delivered");
    expect(provider.createOrder).toHaveBeenCalledOnce();
    expect(provider.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `gate2-payout:${payoutId}`, amountCents: 500 }));
    expect(db.recordOrder).toHaveBeenCalledOnce();
  });
  it("distinguishes a denial from a database outage before provider access", async () => {
    const db = { reserveReferralPayout: vi.fn()
      .mockRejectedValueOnce(new PayoutReservationDenied())
      .mockRejectedValueOnce(new Error("transient")), recordOrder: vi.fn() };
    const provider = { getOrderByKey: vi.fn(), createOrder: vi.fn() };
    expect(await issueReservedReferralPayout(db, provider, vestingId)).toBe("blocked");
    expect(await issueReservedReferralPayout(db, provider, vestingId)).toBe("unavailable");
    expect(provider.getOrderByKey).not.toHaveBeenCalled();
    expect(provider.createOrder).not.toHaveBeenCalled();
  });
  it("rejects another vesting or denomination before provider access", async () => {
    const db = { reserveReferralPayout: vi.fn().mockResolvedValue({
      ...reserved, amountCents: 1000 }), recordOrder: vi.fn() };
    const provider = { getOrderByKey: vi.fn(), createOrder: vi.fn() };
    expect(await issueReservedReferralPayout(db, provider, vestingId)).toBe("blocked");
    expect(provider.getOrderByKey).not.toHaveBeenCalled();
  });
});
