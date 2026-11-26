import { createHmac } from "node:crypto";
import { QuoteV4Schema } from "@envoi-labs/contracts";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/webhooks/stripe-test/route";

const { lookup, wave, makeDb, makeProvider } = vi.hoisted(() => ({
  lookup: vi.fn(), wave: vi.fn(), makeDb: vi.fn(), makeProvider: vi.fn(),
}));
vi.mock("./auth/supabase", async (original) => ({
  ...await original<typeof import("./auth/supabase")>(),
  trustedClient: () => ({ rpc: wave, from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: lookup };
    return query;
  } }),
}));
vi.mock("./platform/gate2-paid-study-db", () =>
  ({ createGate2PaidStudyDatabase: makeDb }));
vi.mock("./platform/gate2-stripe-payment-test", () =>
  ({ createStripeTestPaymentObserver: makeProvider }));

const quote = QuoteV4Schema.parse((QuoteV4Schema.meta()?.examples as unknown[])[0]);
const checkoutId = "cs_test_signed_replay";
const secret = "whsec_signed_replay";
function signedRequest() {
  const body = JSON.stringify({ id: "evt_signed_replay", object: "event",
    livemode: false, type: "checkout.session.completed",
    data: { object: { id: checkoutId, object: "checkout.session" } } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`).digest("hex");
  return new NextRequest("https://labs.example.test/api/webhooks/stripe-test", {
    method: "POST", body,
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
  });
}
function setup() {
  vi.stubEnv("ENVOI_GATE2_TEST_WEBHOOK_ENABLED", "true");
  vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", secret);
  vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_test_fixture");
  lookup.mockResolvedValue({ data: { study_id: quote.studyId,
    quote_id: quote.id }, error: null });
  const observed = { id: checkoutId, eventId: "evt_provider_paid",
    studyId: quote.studyId, quoteId: quote.id,
    pricingConfigVersion: quote.pricingConfigVersion,
    amountCents: quote.totalCents, currency: quote.currency,
    status: "paid" as const, refundedCents: 0,
    observedAt: "2026-11-26T02:00:00.000Z" };
  const provider = { getCheckout: vi.fn().mockResolvedValue(observed) };
  makeProvider.mockReturnValue(provider);
  const seen = new Set<string>();
  let effects = 0;
  let launches = 0;
  let waves = 0;
  let reservations = 0;
  const database = {
    readQuote: vi.fn().mockResolvedValue(quote),
    readCheckoutId: vi.fn().mockResolvedValue(checkoutId),
    recordObservation: vi.fn(async (value: typeof observed) => {
      if (!seen.has(value.eventId)) { seen.add(value.eventId); effects++; }
    }),
    launchPaidStudy: vi.fn(async () => { if (launches === 0) launches++; return true; }),
    expirePaidStudy: vi.fn(async () => {
      if (reservations === 0) reservations++;
      return true;
    }),
  };
  makeDb.mockReturnValue(database);
  wave.mockImplementation(async () => ({ data: { created: waves++ === 0 ? 1 : 0 },
    error: null }));
  return { provider, database, observed,
    counts: () => ({ effects, launches, reservations, waves }) };
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("signed Stripe TEST paid replay through reconciliation", () => {
  it("verifies the signature and binds provider state on three deliveries with one effect", async () => {
    const { provider, database, counts } = setup();
    for (let n = 0; n < 3; n++) {
      const response = await POST(signedRequest());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "launched",
        offersCreated: n === 0 ? 1 : 0 });
    }
    expect(counts()).toEqual({ effects: 1, launches: 1,
      reservations: 0, waves: 3 });
    expect(provider.getCheckout).toHaveBeenCalledTimes(3);
    expect(database.recordObservation).toHaveBeenCalledTimes(3);
    expect(database.expirePaidStudy).not.toHaveBeenCalled();
  });
  it("reserves one frozen refund on three signed deliveries after the deadline", async () => {
    const { database, counts } = setup();
    database.launchPaidStudy.mockResolvedValue(false);
    for (let n = 0; n < 3; n++) {
      const response = await POST(signedRequest());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "refund_reserved" });
    }
    expect(counts()).toEqual({ effects: 1, launches: 0,
      reservations: 1, waves: 0 });
    expect(database.expirePaidStudy).toHaveBeenCalledTimes(3);
  });
  it("rejects a valid webhook whose provider state has the wrong frozen amount", async () => {
    const { provider, database, observed, counts } = setup();
    provider.getCheckout.mockResolvedValue({ ...observed,
      amountCents: observed.amountCents + 200 });
    expect((await POST(signedRequest())).status).toBe(200);
    expect(counts()).toEqual({ effects: 0, launches: 0,
      reservations: 0, waves: 0 });
    expect(database.recordObservation).not.toHaveBeenCalled();
  });
});
