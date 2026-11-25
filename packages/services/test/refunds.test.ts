import { describe, expect, it, vi } from "vitest";
import { reserveUnfilledSlotRefund } from "../src/refunds";

const studyId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const reservationId = "44444444-4444-4444-8444-444444444444";
const value = { reservationId, amountCents: 1000, unfilledSlots: 1,
  idempotencyKey: `gate2-unfilled-refund:${quoteId}` };

describe("proportional unfilled-slot refund reservation", () => {
  it("returns the immutable database decision and stable provider key on retry", async () => {
    const call = vi.fn().mockResolvedValue({ data: value, error: null });
    const first = await reserveUnfilledSlotRefund(call, studyId, quoteId, userId);
    expect(first).toEqual({ status: "reserved", ...value });
    expect(await reserveUnfilledSlotRefund(call, studyId, quoteId, userId)).toEqual(first);
    expect(call).toHaveBeenNthCalledWith(1, "reserve_gate2_unfilled_slot_refund", {
      supplied_study_id: studyId, supplied_quote_id: quoteId,
      supplied_auth_user_id: userId });
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("distinguishes policy refusal, fully filled study and database outage", async () => {
    const call = vi.fn().mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "23514" } })
      .mockRejectedValueOnce(new Error("database unavailable"));
    expect(await reserveUnfilledSlotRefund(call, studyId, quoteId, userId))
      .toEqual({ status: "fully_filled" });
    expect(await reserveUnfilledSlotRefund(call, studyId, quoteId, userId))
      .toEqual({ status: "blocked" });
    expect(await reserveUnfilledSlotRefund(call, studyId, quoteId, userId))
      .toEqual({ status: "unavailable" });
    expect(await reserveUnfilledSlotRefund(call, "invalid", quoteId, userId))
      .toEqual({ status: "blocked" });
    expect(call).toHaveBeenCalledTimes(3);
  });
  it("rejects mismatched or malformed reservation keys", async () => {
    const call = vi.fn().mockResolvedValue({ data: { ...value,
      idempotencyKey: "gate2-unfilled-refund:other" }, error: null });
    expect(await reserveUnfilledSlotRefund(call, studyId, quoteId, userId))
      .toEqual({ status: "unavailable" });
  });
});
