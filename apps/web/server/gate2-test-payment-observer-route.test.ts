import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/researcher/studies/[studyId]/checkout/reconcile/route";

const { getClaims, researcherRow, studyRow, reconcile, makeDb, makeObserver, budget } = vi.hoisted(() => ({
  getClaims: vi.fn(), researcherRow: vi.fn(), studyRow: vi.fn(),
  reconcile: vi.fn(), makeDb: vi.fn(), makeObserver: vi.fn(), budget: vi.fn(),
}));
vi.mock("./auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: { auth: { getClaims }, from: (table: string) => {
    const final = table === "researchers" ? researcherRow : studyRow;
    const query = { select: () => query, eq: () => query, maybeSingle: final };
    return query;
  } }, commit: (response: Response) => response }),
  trustedClient: () => ({}),
}));
vi.mock("./platform/gate2-paid-study-db", () => ({ createGate2PaidStudyDatabase: makeDb }));
vi.mock("./platform/gate2-provider-budget", () => ({ takeGate2TestProviderBudget: budget }));
vi.mock("./platform/gate2-stripe-payment-test", () => ({ createStripeTestPaymentObserver: makeObserver }));
vi.mock("@envoi-labs/services/paid-study", () => ({ reconcileCheckoutObservation: reconcile }));

const origin = "https://labs.example.test";
const studyId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
function post(body: unknown = { quoteId }, requestOrigin = origin) {
  return POST(new NextRequest(`${origin}/api/researcher/studies/${studyId}/checkout/reconcile`, {
    method: "POST", body: JSON.stringify(body),
    headers: { origin: requestOrigin, "content-type": "application/json" },
  }), { params: Promise.resolve({ studyId }) });
}
function authorized() {
  vi.stubEnv("ENVOI_GATE2_TEST_CHECKOUT_ENABLED", "true");
  vi.stubEnv("ENVOI_APP_ORIGIN", origin);
  vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_test_fixture");
  getClaims.mockResolvedValue({ data: { claims: { aal: "aal2", sub: quoteId } }, error: null });
  researcherRow.mockResolvedValue({ data: { id: quoteId, organization_id: studyId }, error: null });
  studyRow.mockResolvedValue({ data: { id: studyId }, error: null });
  makeDb.mockReturnValue({});
  makeObserver.mockReturnValue({});
  budget.mockResolvedValue({ status: "allow" });
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("test-mode checkout observation route", () => {
  it("stays disabled and denies cross-origin or unsanctioned bodies", async () => {
    expect((await post()).status).toBe(404);
    authorized();
    expect((await post({ quoteId }, "https://other.example.test")).status).toBe(403);
    expect((await post({ quoteId, studyId })).status).toBe(400);
    expect(reconcile).not.toHaveBeenCalled();
  });
  it("requires MFA, membership and the same study organization before provider read", async () => {
    authorized();
    getClaims.mockResolvedValueOnce({ data: { claims: { aal: "aal1", sub: quoteId } }, error: null });
    expect((await post()).status).toBe(403);
    researcherRow.mockResolvedValueOnce({ data: null, error: null });
    expect((await post()).status).toBe(403);
    studyRow.mockResolvedValueOnce({ data: null, error: null });
    expect((await post()).status).toBe(404);
    expect(makeObserver).not.toHaveBeenCalled();
  });
  it("reports current provider state without a fielding transition", async () => {
    authorized();
    reconcile.mockResolvedValueOnce("paid").mockResolvedValueOnce("pending")
      .mockResolvedValueOnce("blocked").mockResolvedValueOnce("unavailable");
    const paid = await post();
    expect(paid.status).toBe(200);
    expect(paid.headers.get("cache-control")).toBe("private, no-store");
    expect(await paid.json()).toEqual({ quoteId, paymentStatus: "paid" });
    expect(budget).toHaveBeenCalledWith({}, studyId, quoteId, "reconcile");
    expect(reconcile).toHaveBeenCalledWith({}, {}, studyId, quoteId);
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(409);
    expect((await post()).status).toBe(503);
  });
  it("denies repeated provider reads and outages before observer creation", async () => {
    authorized();
    budget.mockResolvedValue({ status: "limited", retryAfterSeconds: 42 });
    const denied = await Promise.all(Array.from({ length: 4 }, () => post()));
    expect(denied.map((response) => response.status)).toEqual([429, 429, 429, 429]);
    expect(denied.every((response) => response.headers.get("retry-after") === "42")).toBe(true);
    expect(makeObserver).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    budget.mockResolvedValueOnce({ status: "unavailable" });
    expect((await post()).status).toBe(503);
    expect(makeObserver).not.toHaveBeenCalled();
  });
});
