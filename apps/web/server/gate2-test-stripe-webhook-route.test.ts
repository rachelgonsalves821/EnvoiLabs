import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/webhooks/stripe-test/route";

const { verify, lookup, wave, reconcileLaunch, reconcileObservation,
  makeDb, makeProvider } = vi.hoisted(() => ({
  verify: vi.fn(), lookup: vi.fn(), wave: vi.fn(), reconcileLaunch: vi.fn(),
  reconcileObservation: vi.fn(), makeDb: vi.fn(), makeProvider: vi.fn(),
}));
vi.mock("./platform/gate2-stripe-webhook", () =>
  ({ verifyStripeTestCheckoutHint: verify }));
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
vi.mock("@envoi-labs/services/paid-study", () => ({
  reconcilePaidStudyLaunch: reconcileLaunch,
  reconcileCheckoutObservation: reconcileObservation,
}));

const studyId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
const hint = { eventId: "evt_test_1", type: "checkout.session.completed",
  checkoutId: "cs_test_fixture_1" };
const request = () => new NextRequest("https://labs.example.test/api/webhooks/stripe-test", {
  method: "POST", body: '{"raw":"fixture"}',
  headers: { "stripe-signature": "t=fixture,v1=fixture" },
});
function enabled() {
  vi.stubEnv("ENVOI_GATE2_TEST_WEBHOOK_ENABLED", "true");
  vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "whsec_fixture");
  vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_test_fixture");
  verify.mockReturnValue(hint);
  lookup.mockResolvedValue({ data: { study_id: studyId, quote_id: quoteId },
    error: null });
  makeDb.mockReturnValue({}); makeProvider.mockReturnValue({});
  wave.mockResolvedValue({ data: { created: 0, remaining: 0 }, error: null });
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("signed test Checkout webhook route", () => {
  it("stays disabled and rejects bad signature or live key", async () => {
    expect((await POST(request())).status).toBe(404);
    enabled();
    verify.mockReturnValueOnce(null);
    expect((await POST(request())).status).toBe(400);
    vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_live_forbidden");
    expect((await POST(request())).status).toBe(503);
    expect(reconcileLaunch).not.toHaveBeenCalled();
  });
  it("ignores a signed but unstored Session identity", async () => {
    enabled();
    lookup.mockResolvedValueOnce({ data: null, error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ignored" });
    expect(makeProvider).not.toHaveBeenCalled();
  });
  it("uses current provider state to launch and safely replay", async () => {
    enabled();
    reconcileLaunch.mockResolvedValue("launched");
    for (let n = 0; n < 3; n++) {
      const response = await POST(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "launched", offersCreated: 0 });
    }
    expect(reconcileLaunch).toHaveBeenCalledTimes(3);
    expect(reconcileLaunch).toHaveBeenCalledWith({}, {}, studyId, quoteId);
    expect(wave).toHaveBeenCalledWith("create_gate2_paid_launch_wave", {
      supplied_study_id: studyId, supplied_quote_id: quoteId });
  });
  it("retries the offer wave after a post-launch database outage", async () => {
    enabled();
    reconcileLaunch.mockResolvedValue("launched");
    wave.mockResolvedValueOnce({ data: null, error: { code: "08000" } })
      .mockResolvedValueOnce({ data: { created: 2, remaining: 8 }, error: null });
    expect((await POST(request())).status).toBe(503);
    expect(await (await POST(request())).json()).toEqual({
      status: "launched", offersCreated: 2 });
  });
  it("observes failure without launch and retries provider uncertainty", async () => {
    enabled();
    verify.mockReturnValue({ ...hint, type: "checkout.session.expired" });
    reconcileObservation.mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("unavailable");
    expect((await POST(request())).status).toBe(200);
    expect((await POST(request())).status).toBe(503);
    expect(reconcileLaunch).not.toHaveBeenCalled();
  });
});
