import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/researcher/studies/[studyId]/refund/route";

const { getClaims, researcherRow, studyRow, reserve, settle, makeDb, makeProvider } =
  vi.hoisted(() => ({ getClaims: vi.fn(), researcherRow: vi.fn(), studyRow: vi.fn(),
    reserve: vi.fn(), settle: vi.fn(), makeDb: vi.fn(), makeProvider: vi.fn() }));
vi.mock("./auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: { auth: { getClaims }, from: (table: string) => {
    const final = table === "researchers" ? researcherRow : studyRow;
    const query = { select: () => query, eq: () => query, maybeSingle: final };
    return query;
  } }, commit: (response: Response) => response }),
  trustedClient: () => ({ rpc: vi.fn() }),
}));
vi.mock("@envoi-labs/services/refunds", () => ({ reserveUnfilledSlotRefund: reserve }));
vi.mock("@envoi-labs/services/refund-settlement", () => ({ settleReservedRefund: settle }));
vi.mock("./platform/gate2-refund-db", () => ({ createGate2RefundDatabase: makeDb }));
vi.mock("./platform/gate2-stripe-refund-test", () =>
  ({ createStripeTestRefundProvider: makeProvider }));

const origin = "https://labs.example.test";
const studyId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
const reservationId = "33333333-3333-4333-8333-333333333333";
function post(body: unknown = { quoteId }, requestOrigin = origin) {
  return POST(new NextRequest(`${origin}/api/researcher/studies/${studyId}/refund`, {
    method: "POST", body: JSON.stringify(body),
    headers: { origin: requestOrigin, "content-type": "application/json" },
  }), { params: Promise.resolve({ studyId }) });
}
function authorized() {
  vi.stubEnv("ENVOI_GATE2_TEST_REFUND_ENABLED", "true");
  vi.stubEnv("ENVOI_APP_ORIGIN", origin);
  vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_test_fixture");
  getClaims.mockResolvedValue({ data: { claims: { aal: "aal2", sub: quoteId } }, error: null });
  researcherRow.mockResolvedValue({ data: { id: quoteId,
    organization_id: studyId }, error: null });
  studyRow.mockResolvedValue({ data: { id: studyId }, error: null });
  makeDb.mockReturnValue({}); makeProvider.mockReturnValue({});
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("test-mode proportional refund route", () => {
  it("stays disabled and denies cross-origin or extra body fields", async () => {
    expect((await post()).status).toBe(404);
    authorized();
    expect((await post({ quoteId }, "https://other.example.test")).status).toBe(403);
    expect((await post({ quoteId, studyId })).status).toBe(400);
    expect(makeProvider).not.toHaveBeenCalled();
  });
  it("requires MFA, researcher membership and study ownership", async () => {
    authorized();
    getClaims.mockResolvedValueOnce({ data: { claims: { aal: "aal1", sub: quoteId } },
      error: null });
    expect((await post()).status).toBe(403);
    researcherRow.mockResolvedValueOnce({ data: null, error: null });
    expect((await post()).status).toBe(403);
    studyRow.mockResolvedValueOnce({ data: null, error: null });
    expect((await post()).status).toBe(404);
    expect(makeProvider).not.toHaveBeenCalled();
  });
  it("refuses a live Stripe key before reserving money", async () => {
    authorized();
    vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_live_forbidden");
    expect((await post()).status).toBe(503);
    expect(reserve).not.toHaveBeenCalled();
    expect(makeProvider).not.toHaveBeenCalled();
  });
  it("reserves the original unfilled amount before provider settlement", async () => {
    authorized();
    reserve.mockResolvedValue({ status: "reserved", reservationId,
      amountCents: 1000, unfilledSlots: 1,
      idempotencyKey: `gate2-unfilled-refund:${quoteId}` });
    settle.mockResolvedValue({ status: "pending", refundId: "re_test_1",
      amountCents: 1000 });
    const result = await post();
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ quoteId, refundStatus: "pending",
      amountCents: 1000, refundId: "re_test_1" });
    expect(reserve).toHaveBeenCalledWith(expect.any(Function), studyId, quoteId, quoteId);
    expect(settle).toHaveBeenCalledWith({ reservationId, authUserId: quoteId,
      database: {}, provider: {} });
  });
  it("does not construct a provider for blocked, uncertain or full reservations", async () => {
    authorized();
    reserve.mockResolvedValueOnce({ status: "blocked" })
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValueOnce({ status: "fully_filled" });
    expect((await post()).status).toBe(409);
    expect((await post()).status).toBe(503);
    const full = await post();
    expect(await full.json()).toEqual({ quoteId, refundStatus: "fully_filled" });
    expect(makeProvider).not.toHaveBeenCalled();
  });
});
