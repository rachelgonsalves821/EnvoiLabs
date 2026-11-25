import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/webhooks/stripe-test-refund/route";

const { verify, lookup, makeRefundDb, getRefund, createRefund,
  makePaidDb, makePaymentObserver, reconcile } = vi.hoisted(() => ({
  verify: vi.fn(), lookup: vi.fn(), makeRefundDb: vi.fn(),
  getRefund: vi.fn(), createRefund: vi.fn(), makePaidDb: vi.fn(),
  makePaymentObserver: vi.fn(), reconcile: vi.fn(),
}));
vi.mock("./platform/gate2-stripe-webhook", () =>
  ({ verifyStripeTestRefundHint: verify }));
vi.mock("./auth/supabase", async (original) => ({
  ...await original<typeof import("./auth/supabase")>(),
  trustedClient: () => ({}),
}));
vi.mock("./platform/gate2-refund-db", () => ({
  readGate2RefundWebhookClaim: lookup,
  createGate2RefundDatabase: makeRefundDb,
}));
vi.mock("./platform/gate2-stripe-refund-test", () => ({
  createStripeTestRefundProvider: () => ({ get: getRefund, create: createRefund }),
}));
vi.mock("./platform/gate2-paid-study-db", () =>
  ({ createGate2PaidStudyDatabase: makePaidDb }));
vi.mock("./platform/gate2-stripe-payment-test", () =>
  ({ createStripeTestPaymentObserver: makePaymentObserver }));
vi.mock("@envoi-labs/services/paid-study", () =>
  ({ reconcileCheckoutObservation: reconcile }));

const intent = { reservationId: "33333333-3333-4333-8333-333333333333",
  studyId: "11111111-1111-4111-8111-111111111111",
  quoteId: "22222222-2222-4222-8222-222222222222",
  checkoutId: "cs_test_fixture_1", amountCents: 1000,
  quoteTotalCents: 12000, pricingConfigVersion: 101,
  key: "gate2-unfilled-refund:22222222-2222-4222-8222-222222222222" };
const hint = { eventId: "evt_refund_1", type: "refund.updated",
  refundId: "re_test_1", reservationId: intent.reservationId };
const observation = { refundId: hint.refundId, kind: "succeeded",
  amountCents: 1000, observedAt: "2026-11-24T12:00:00.000Z" };
const request = () => new NextRequest("https://labs.example.test/api/webhooks/stripe-test-refund", {
  method: "POST", body: '{"raw":"fixture"}',
  headers: { "stripe-signature": "t=fixture,v1=fixture" },
});
function enabled() {
  vi.stubEnv("ENVOI_GATE2_TEST_WEBHOOK_ENABLED", "true");
  vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "whsec_fixture");
  vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_test_fixture");
  verify.mockReturnValue(hint);
  lookup.mockResolvedValue(intent);
  getRefund.mockResolvedValue(observation);
  makeRefundDb.mockReturnValue({ record: vi.fn().mockResolvedValue(true) });
  makePaidDb.mockReturnValue({}); makePaymentObserver.mockReturnValue({});
  reconcile.mockResolvedValue("refunded");
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("signed test refund webhook route", () => {
  it("stays off, rejects bad signatures and live keys", async () => {
    expect((await POST(request())).status).toBe(404);
    enabled(); verify.mockReturnValueOnce(null);
    expect((await POST(request())).status).toBe(400);
    vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_live_forbidden");
    expect((await POST(request())).status).toBe(503);
    expect(getRefund).not.toHaveBeenCalled();
  });
  it("ignores a signed event with no durable reservation intent", async () => {
    enabled(); lookup.mockResolvedValueOnce(null);
    expect(await (await POST(request())).json()).toEqual({ status: "ignored" });
    expect(getRefund).not.toHaveBeenCalled();
  });
  it("re-fetches the exact provider refund and records one immutable state on replay", async () => {
    enabled();
    for (let n = 0; n < 3; n++) {
      const response = await POST(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "succeeded" });
    }
    expect(getRefund).toHaveBeenCalledTimes(3);
    expect(getRefund).toHaveBeenCalledWith(hint.refundId, intent);
    expect(createRefund).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(3);
  });
  it("keeps pending refunds distinct from settled payment evidence", async () => {
    enabled(); getRefund.mockResolvedValueOnce({ ...observation, kind: "pending" });
    expect(await (await POST(request())).json()).toEqual({ status: "pending" });
    expect(reconcile).not.toHaveBeenCalled();
  });
});
