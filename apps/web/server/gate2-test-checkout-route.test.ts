import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/researcher/studies/[studyId]/checkout/route";

const { getClaims, membership, prepare, makeDb, makeProvider, budget } = vi.hoisted(() => ({
  getClaims: vi.fn(), membership: vi.fn(), prepare: vi.fn(),
  makeDb: vi.fn(), makeProvider: vi.fn(), budget: vi.fn(),
}));
vi.mock("./auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: {
    auth: { getClaims }, from: () => ({ select: () => ({ eq: () => ({
      maybeSingle: membership,
      eq: () => ({ maybeSingle: membership }),
    }) }) }),
  }, commit: (response: Response) => response }),
  trustedClient: () => ({}),
}));
vi.mock("./platform/gate2-checkout-db", () => ({ createGate2CheckoutDatabase: makeDb }));
vi.mock("./platform/gate2-provider-budget", () => ({ takeGate2TestProviderBudget: budget }));
vi.mock("./platform/gate2-stripe-test", () => ({ createStripeTestCheckoutProvider: makeProvider }));
vi.mock("@envoi-labs/services/checkout", () => ({ prepareStudyCheckout: prepare }));

const origin = "https://labs.example.test";
const studyId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
function post(body: unknown = {}, requestOrigin = origin) {
  return POST(new NextRequest(`${origin}/api/researcher/studies/${studyId}/checkout`, {
    method: "POST", body: JSON.stringify(body),
    headers: { origin: requestOrigin, "content-type": "application/json" },
  }), { params: Promise.resolve({ studyId }) });
}

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("disabled test-mode researcher checkout route", () => {
  it("denies use until explicitly enabled and rejects cross-origin input", async () => {
    expect((await post()).status).toBe(404);
    vi.stubEnv("ENVOI_GATE2_TEST_CHECKOUT_ENABLED", "true");
    vi.stubEnv("ENVOI_APP_ORIGIN", origin);
    expect((await post({}, "https://other.example.test")).status).toBe(403);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("requires MFA and researcher membership before provider setup", async () => {
    vi.stubEnv("ENVOI_GATE2_TEST_CHECKOUT_ENABLED", "true");
    vi.stubEnv("ENVOI_APP_ORIGIN", origin);
    vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_test_fixture");
    getClaims.mockResolvedValueOnce({ data: { claims: { sub: quoteId, aal: "aal1" } }, error: null });
    expect((await post()).status).toBe(403);
    getClaims.mockResolvedValueOnce({ data: { claims: { sub: quoteId, aal: "aal2" } }, error: null });
    membership.mockResolvedValueOnce({ data: null, error: null });
    expect((await post()).status).toBe(403);
    expect(makeProvider).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("returns only a private quote summary and exact test checkout URL", async () => {
    vi.stubEnv("ENVOI_GATE2_TEST_CHECKOUT_ENABLED", "true");
    vi.stubEnv("ENVOI_APP_ORIGIN", origin);
    vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_test_fixture");
    getClaims.mockResolvedValue({ data: { claims: { sub: quoteId, aal: "aal2" } }, error: null });
    membership.mockResolvedValue({ data: { id: quoteId, organization_id: studyId }, error: null });
    budget.mockResolvedValue({ status: "allow" });
    makeDb.mockReturnValue({});
    makeProvider.mockReturnValue({});
    const feasibility = { basis: "insufficient_history", fillHours: null };
    prepare.mockResolvedValue({ status: "ready", quote: {
      id: quoteId, totalCents: 10_000, currency: "usd", feasibility },
    checkout: { url: "https://checkout.stripe.com/c/pay/cs_test_fixture" } });
    const result = await post();
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ quoteId, totalCents: 10_000,
      currency: "usd", feasibility,
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_fixture" });
    expect(makeDb).toHaveBeenCalledWith({}, {
      id: quoteId, organizationId: studyId, authUserId: quoteId });
    expect(prepare).toHaveBeenCalledWith({}, {}, studyId);
    prepare.mockResolvedValueOnce({ status: "blocked" });
    expect((await post()).status).toBe(409);
    expect((await post({ quoteId })).status).toBe(400);
  });

  it("shares an atomic budget before any Stripe setup and fails closed", async () => {
    vi.stubEnv("ENVOI_GATE2_TEST_CHECKOUT_ENABLED", "true");
    vi.stubEnv("ENVOI_APP_ORIGIN", origin);
    vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_test_fixture");
    getClaims.mockResolvedValue({ data: { claims: { sub: quoteId, aal: "aal2" } }, error: null });
    membership.mockResolvedValue({ data: { id: quoteId, organization_id: studyId }, error: null });
    budget.mockResolvedValue({ status: "limited", retryAfterSeconds: 42 });
    const denied = await Promise.all(Array.from({ length: 4 }, () => post()));
    expect(denied.map((response) => response.status)).toEqual([429, 429, 429, 429]);
    expect(denied.every((response) => response.headers.get("retry-after") === "42")).toBe(true);
    expect(makeProvider).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    budget.mockResolvedValueOnce({ status: "unavailable" });
    expect((await post()).status).toBe(503);
    expect(makeProvider).not.toHaveBeenCalled();
  });
});
