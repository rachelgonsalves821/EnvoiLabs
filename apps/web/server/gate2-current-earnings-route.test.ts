import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/respondent/earnings/route";

const { getClaims, rpc } = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: { auth: { getClaims }, rpc },
    commit: (response: Response) => response }),
}));

function get() {
  return GET(new NextRequest("https://labs.example.test/api/respondent/earnings"));
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("current respondent earnings", () => {
  it("is disabled by default and requires a signed-in respondent", async () => {
    expect((await get()).status).toBe(404);
    vi.stubEnv("ENVOI_GATE2_EARNINGS_ENABLED", "true");
    getClaims.mockResolvedValue({ data: { claims: {} }, error: null });
    expect((await get()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reads a private current snapshot and fails closed on denied or failed reads", async () => {
    vi.stubEnv("ENVOI_GATE2_EARNINGS_ENABLED", "true");
    getClaims.mockResolvedValue({ data: { claims: { sub: "respondent" } }, error: null });
    const earnings = { currency: "usd", earnedCents: 300, deliveredCents: 0,
      sessions: [{ earnedCents: 300, payoutStatus: "pending" }],
      referral: { verifiedProfiles: 4, vestedBonusCents: 0 } };
    rpc.mockResolvedValueOnce({ data: earnings, error: null });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(earnings);
    expect(rpc).toHaveBeenCalledWith("read_gate2_current_respondent_earnings");
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await get()).status).toBe(404);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect((await get()).status).toBe(503);
  });
});
