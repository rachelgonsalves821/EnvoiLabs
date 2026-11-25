import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/researcher/studies/[studyId]/receipt/route";

const { getClaims, rpc } = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: { auth: { getClaims }, rpc },
    commit: (response: Response) => response }),
}));

const studyId = "11111111-1111-4111-8111-111111111111";
function get(id = studyId) {
  return GET(new NextRequest(`https://labs.example.test/api/researcher/studies/${id}/receipt`),
    { params: Promise.resolve({ studyId: id }) });
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("current researcher money receipt", () => {
  it("is disabled by default and checks MFA before a database read", async () => {
    expect((await get()).status).toBe(404);
    vi.stubEnv("ENVOI_GATE2_TEST_CHECKOUT_ENABLED", "true");
    getClaims.mockResolvedValue({ data: { claims: { sub: studyId, aal: "aal1" } }, error: null });
    expect((await get()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns a private current snapshot and hides a foreign or missing study", async () => {
    vi.stubEnv("ENVOI_GATE2_TEST_CHECKOUT_ENABLED", "true");
    getClaims.mockResolvedValue({ data: { claims: { sub: studyId, aal: "aal2" } }, error: null });
    expect((await get("bad-id")).status).toBe(404);
    const receipt = { studyId, quoteId: studyId, paymentStatus: "paid",
      totalCents: 10000, refund: { status: "reserved", amountCents: 2000 } };
    rpc.mockResolvedValueOnce({ data: receipt, error: null });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(receipt);
    expect(rpc).toHaveBeenCalledWith("read_gate2_current_researcher_receipt",
      { supplied_study_id: studyId });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await get()).status).toBe(404);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect((await get()).status).toBe(503);
  });
});
