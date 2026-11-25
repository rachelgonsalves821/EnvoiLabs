import { describe, expect, it, vi } from "vitest";
import { createStripeTestPaymentObserver } from "./gate2-stripe-payment-test";

const session = { id: "cs_test_fixture_1", object: "checkout.session", livemode: false,
  mode: "payment", client_reference_id: "a9900000-0000-4000-8000-000000000001",
  amount_total: 500, currency: "usd", status: "complete", payment_status: "paid",
  payment_intent: "pi_fixture_1", metadata: {
    studyId: "90600000-0000-4000-8000-000000000001",
    quoteId: "a9900000-0000-4000-8000-000000000001", pricingConfigVersion: "100" } };
const payment = { id: "pi_fixture_1", object: "payment_intent", livemode: false,
  amount: 500, amount_received: 500, currency: "usd", status: "succeeded" };
const refunds = { object: "list", has_more: false, data: [] };
const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

function setup(values: unknown[] = [session, payment, refunds]) {
  const request = vi.fn();
  values.forEach((value) => request.mockResolvedValueOnce(response(value)));
  const provider = createStripeTestPaymentObserver({ secretKey: "sk_test_fixture",
    request, now: () => new Date("2026-11-24T10:00:00.000Z") });
  return { provider, request };
}

describe("Stripe test-mode paid observation", () => {
  it("fetches Session, PaymentIntent and complete refunds before claiming paid", async () => {
    const { provider, request } = setup();
    expect(await provider.getCheckout(session.id)).toMatchObject({ status: "paid",
      amountCents: 500, refundedCents: 0, quoteId: session.client_reference_id,
      pricingConfigVersion: 100,
      eventId: `stripe-checkout-state:${session.id}:paid:0` });
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      `https://api.stripe.com/v1/checkout/sessions/${session.id}`,
      "https://api.stripe.com/v1/payment_intents/pi_fixture_1",
      "https://api.stripe.com/v1/refunds?payment_intent=pi_fixture_1&limit=100",
    ]);
  });

  it("reports a verified partial refund before launch", async () => {
    const { provider } = setup([session, payment, { ...refunds, data: [{ object: "refund",
      payment_intent: payment.id, currency: "usd", amount: 200, status: "succeeded" }] }]);
    expect(await provider.getCheckout(session.id)).toMatchObject({ status: "refunded",
      refundedCents: 200, eventId: `stripe-checkout-state:${session.id}:refunded:200` });
  });

  it.each(["pending", "requires_action"])("does not count a %s refund as settled", async (status) => {
    const { provider } = setup([session, payment, { ...refunds, data: [{ object: "refund",
      payment_intent: payment.id, currency: "usd", amount: 200, status }] }]);
    await expect(provider.getCheckout(session.id)).rejects.toThrow("Uncertain refund state");
  });

  it("keeps unpaid or expired Sessions from launching", async () => {
    const pending = setup([{ ...session, status: "open", payment_status: "unpaid",
      payment_intent: null }]);
    expect(await pending.provider.getCheckout(session.id)).toMatchObject({ status: "pending" });
    expect(pending.request).toHaveBeenCalledTimes(1);
    const expired = setup([{ ...session, status: "expired", payment_status: "unpaid",
      payment_intent: null }]);
    expect(await expired.provider.getCheckout(session.id)).toMatchObject({ status: "failed" });
    const asynchronousFailure = setup([{ ...session, payment_status: "unpaid" },
      { ...payment, status: "requires_payment_method", amount_received: 0 }]);
    expect(await asynchronousFailure.provider.getCheckout(session.id))
      .toMatchObject({ status: "failed" });
    expect(asynchronousFailure.request).toHaveBeenCalledTimes(2);
  });

  it("fails closed on incomplete refund pages or mismatched provider identity", async () => {
    const incomplete = setup([session, payment, { ...refunds, has_more: true }]);
    await expect(incomplete.provider.getCheckout(session.id)).rejects.toThrow("Incomplete");
    const mismatched = setup([{ ...session, client_reference_id: "other" }]);
    await expect(mismatched.provider.getCheckout(session.id)).rejects.toThrow("frozen quote");
    expect(() => createStripeTestPaymentObserver({ secretKey: "sk_live_fixture" }))
      .toThrow("Test-mode");
  });
});
