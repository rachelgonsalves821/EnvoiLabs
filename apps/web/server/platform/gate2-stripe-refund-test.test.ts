import { describe, expect, it, vi } from "vitest";
import { createStripeTestRefundProvider, type TestRefundIntent } from "./gate2-stripe-refund-test";

const intent: TestRefundIntent = {
  reservationId: "a9850000-0000-4000-8000-000000000002",
  studyId: "a9850000-0000-4000-8000-000000000001",
  quoteId: "a9850000-0000-4000-8000-000000000003",
  checkoutId: "cs_test_refund_1", amountCents: 1000,
  quoteTotalCents: 12000, pricingConfigVersion: 101,
  key: "gate2-unfilled-refund:a9850000-0000-4000-8000-000000000003",
};
const session = { object: "checkout.session", id: intent.checkoutId,
  livemode: false, status: "complete", payment_status: "paid", mode: "payment",
  currency: "usd", amount_total: 12000, client_reference_id: intent.quoteId,
  payment_intent: "pi_refund_1", metadata: { quoteId: intent.quoteId,
    studyId: intent.studyId, pricingConfigVersion: "101" } };
const payment = { object: "payment_intent", id: "pi_refund_1", livemode: false,
  status: "succeeded", currency: "usd", amount: 12000, amount_received: 12000 };
const refund = { object: "refund", id: "re_refund_1", payment_intent: "pi_refund_1",
  amount: 1000, currency: "usd", status: "succeeded",
  metadata: { reservationId: intent.reservationId, quoteId: intent.quoteId,
    studyId: intent.studyId } };
const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

function provider(responses: unknown[]) {
  const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input; void init;
    return reply(responses.shift());
  });
  return { api: createStripeTestRefundProvider({ secretKey: "sk_test_fixture",
    request, now: () => new Date("2026-11-24T12:00:00.000Z") }), request };
}

describe("Stripe test-mode partial refund", () => {
  it("requires a test key before any provider request", () => {
    expect(() => createStripeTestRefundProvider({ secretKey: "sk_live_wrong" }))
      .toThrow("Test-mode");
  });
  it("validates exact paid Checkout and PaymentIntent before one refund create", async () => {
    const { api, request } = provider([session, payment,
      { object: "list", has_more: false, data: [] }, refund]);
    await expect(api.create(intent)).resolves.toEqual({ refundId: "re_refund_1",
      kind: "succeeded", amountCents: 1000,
      observedAt: "2026-11-24T12:00:00.000Z" });
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[3]?.[0]).toBe("https://api.stripe.com/v1/refunds");
    expect(request.mock.calls[3]?.[1]).toMatchObject({ method: "POST",
      headers: { "Idempotency-Key": intent.key } });
  });
  it("recovers one matching existing refund without creating another", async () => {
    const { api, request } = provider([session, payment,
      { object: "list", has_more: false, data: [refund] }]);
    await expect(api.create(intent)).resolves.toMatchObject({ refundId: refund.id });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("retrieves only the exact stored refund identity", async () => {
    const { api, request } = provider([session, payment, refund]);
    await expect(api.get(refund.id, intent)).resolves.toMatchObject({ kind: "succeeded" });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2]?.[0]).toBe(`https://api.stripe.com/v1/refunds/${refund.id}`);
  });
  it("fails closed on incomplete listing, unrelated refund or mismatched quote", async () => {
    const incomplete = provider([session, payment,
      { object: "list", has_more: true, data: [] }]);
    await expect(incomplete.api.create(intent)).rejects.toThrow("Incomplete");
    expect(incomplete.request).toHaveBeenCalledTimes(3);
    const other = provider([session, payment,
      { object: "list", has_more: false, data: [{ ...refund,
        metadata: { ...refund.metadata, reservationId: "other" } }] }]);
    await expect(other.api.create(intent)).rejects.toThrow("does not match");
    expect(other.request).toHaveBeenCalledTimes(3);
    const wrong = provider([{ ...session, client_reference_id: "other" }]);
    await expect(wrong.api.create(intent)).rejects.toThrow("does not match");
    expect(wrong.request).toHaveBeenCalledTimes(1);
    const wrongTotal = provider([{ ...session, amount_total: 13000 }]);
    await expect(wrongTotal.api.create(intent)).rejects.toThrow("does not match");
    expect(wrongTotal.request).toHaveBeenCalledTimes(1);
    const wrongVersion = provider([{ ...session, metadata: {
      ...session.metadata, pricingConfigVersion: "102" } }]);
    await expect(wrongVersion.api.create(intent)).rejects.toThrow("does not match");
    expect(wrongVersion.request).toHaveBeenCalledTimes(1);
  });
});
