import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as requestRefund } from
  "../app/api/researcher/studies/[studyId]/refund/route";
import { POST as observeRefund } from
  "../app/api/webhooks/stripe-test-refund/route";

const { rpc, getClaims, researcher, study, reconciled } = vi.hoisted(() => ({
  rpc: vi.fn(), getClaims: vi.fn(), researcher: vi.fn(), study: vi.fn(),
  reconciled: vi.fn(),
}));
vi.mock("./auth/supabase", async (original) => ({
  ...await original<typeof import("./auth/supabase")>(),
  appOrigin: () => "https://labs.example.test",
  requestSession: () => ({ client: { auth: { getClaims },
    from: (table: string) => {
      const query = { select: () => query, eq: () => query,
        maybeSingle: table === "researchers" ? researcher : study };
      return query;
    } }, commit: (response: Response) => response }),
  trustedClient: () => ({ rpc }),
}));
vi.mock("@envoi-labs/services/paid-study", async (original) => ({
  ...await original<typeof import("@envoi-labs/services/paid-study")>(),
  reconcileCheckoutObservation: reconciled,
}));
vi.mock("./platform/gate2-paid-study-db", () =>
  ({ createGate2PaidStudyDatabase: () => ({}) }));
vi.mock("./platform/gate2-stripe-payment-test", () =>
  ({ createStripeTestPaymentObserver: () => ({}) }));

const studyId = "a9f40000-0000-4000-8000-000000000001";
const quoteId = "a9f40000-0000-4000-8000-000000000002";
const reservationId = "a9f40000-0000-4000-8000-000000000003";
const userId = "90200000-0000-4000-8000-000000000001";
const checkoutId = "cs_test_expired_paid";
const refundId = "re_expired_paid";
const key = `gate2-unfilled-refund:${quoteId}`;
const secret = "whsec_test_refund_integration";
const amount = 12000;
const intent = { reservationId, studyId, quoteId, checkoutId,
  amountCents: amount, quoteTotalCents: amount, pricingConfigVersion: 101, key };
const checkout = { object: "checkout.session", id: checkoutId,
  livemode: false, status: "complete", payment_status: "paid",
  mode: "payment", currency: "usd", amount_total: amount,
  client_reference_id: quoteId, payment_intent: "pi_expired_paid",
  metadata: { quoteId, studyId, pricingConfigVersion: "101" } };
const payment = { object: "payment_intent", id: "pi_expired_paid",
  livemode: false, status: "succeeded", currency: "usd",
  amount, amount_received: amount };
const refund = (status: "pending" | "succeeded") => ({
  object: "refund", id: refundId, payment_intent: payment.id,
  amount, currency: "usd", status,
  metadata: { reservationId, quoteId, studyId },
});
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
function researcherRequest() {
  return requestRefund(new NextRequest(
    `https://labs.example.test/api/researcher/studies/${studyId}/refund`, {
      method: "POST", body: JSON.stringify({ quoteId }),
      headers: { origin: "https://labs.example.test",
        "content-type": "application/json" },
    }), { params: Promise.resolve({ studyId }) });
}
function signedWebhook() {
  const body = JSON.stringify({ object: "event", id: "evt_refund_signed",
    livemode: false, type: "refund.updated",
    data: { object: refund("succeeded") } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`).digest("hex");
  return observeRefund(new NextRequest(
    "https://labs.example.test/api/webhooks/stripe-test-refund", {
      method: "POST", body,
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    }));
}
function setup() {
  vi.stubEnv("ENVOI_GATE2_TEST_REFUND_ENABLED", "true");
  vi.stubEnv("ENVOI_GATE2_TEST_WEBHOOK_ENABLED", "true");
  vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_test_fixture");
  vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", secret);
  getClaims.mockResolvedValue({ data: { claims: { aal: "aal2",
    sub: userId } }, error: null });
  researcher.mockResolvedValue({ data: { id: userId,
    organization_id: studyId }, error: null });
  study.mockResolvedValue({ data: { id: studyId }, error: null });
  reconciled.mockResolvedValue("refunded");
  let known = false;
  let providerStatus: "pending" | "succeeded" = "pending";
  const events = new Set<string>();
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    switch (name) {
      case "reserve_gate2_unfilled_slot_refund":
        if (args.supplied_study_id !== studyId ||
          args.supplied_quote_id !== quoteId ||
          args.supplied_auth_user_id !== userId) throw new Error("Wrong reservation principal");
        return { data: { reservationId, amountCents: amount,
          unfilledSlots: 12, idempotencyKey: key }, error: null };
      case "claim_gate2_refund_intent":
        if (args.requested_reservation_id !== reservationId ||
          args.supplied_auth_user_id !== userId) throw new Error("Wrong refund claimant");
        return { data: known ? { status: "known", refundId,
          ...intent } : { status: "create", ...intent }, error: null };
      case "record_gate2_refund_observation":
        if (args.requested_reservation_id !== reservationId ||
          args.requested_refund_id !== refundId ||
          args.requested_amount_cents !== amount ||
          args.requested_kind !== providerStatus)
          throw new Error("Wrong provider observation");
        known = true;
        events.add(args.requested_kind as string);
        return { data: true, error: null };
      case "read_gate2_refund_webhook_claim":
        if (args.requested_reservation_id !== reservationId)
          throw new Error("Wrong webhook reservation");
        return { data: known ? intent : null, error: null };
      default: throw new Error(`Unexpected RPC ${name}`);
    }
  });
  const requests: { url: string; method: string; key: string | undefined }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const method = options?.method ?? "GET";
    requests.push({ url, method,
      key: (options?.headers as Record<string, string> | undefined)?.["Idempotency-Key"] });
    if (url.endsWith(`/checkout/sessions/${checkoutId}`)) return json(checkout);
    if (url.endsWith(`/payment_intents/${payment.id}`)) return json(payment);
    if (url.includes("/refunds?"))
      return json({ object: "list", has_more: false, data: [] });
    if (url.endsWith(`/refunds/${refundId}`)) return json(refund(providerStatus));
    if (url.endsWith("/refunds") && method === "POST")
      return json(refund(providerStatus));
    throw new Error(`Unexpected synthetic Stripe request ${method} ${url}`);
  }));
  return { requests, events,
    succeed: () => { providerStatus = "succeeded"; } };
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("expired paid TEST refund through signed provider observation", () => {
  it("creates once, retrieves on researcher retry, then accepts signed triple replay", async () => {
    const state = setup();
    expect(await (await researcherRequest()).json()).toEqual({ quoteId,
      refundStatus: "pending", amountCents: amount, refundId });
    expect(state.requests.filter((item) => item.method === "POST"))
      .toEqual([{ url: "https://api.stripe.com/v1/refunds",
        method: "POST", key }]);
    expect(await (await researcherRequest()).json()).toEqual({ quoteId,
      refundStatus: "pending", amountCents: amount, refundId });
    expect(state.requests.filter((item) => item.method === "POST")).toHaveLength(1);
    state.succeed();
    for (let n = 0; n < 3; n++) {
      const response = await signedWebhook();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "succeeded" });
    }
    expect(state.events).toEqual(new Set(["pending", "succeeded"]));
    expect(reconciled).toHaveBeenCalledTimes(3);
    expect(state.requests.filter((item) => item.method === "POST")).toHaveLength(1);
  });
});
