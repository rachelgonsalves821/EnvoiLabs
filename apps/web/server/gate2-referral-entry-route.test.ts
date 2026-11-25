import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/respondent/referral/route";
import { GET as VISIT } from "../app/(respondent)/r/ref/[code]/route";

const { getClaims, rpc } = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: { auth: { getClaims }, rpc },
    commit: (response: Response) => response }),
}));
const origin = "https://labs.example.test";
const code = "11111111-1111-4111-8111-111111111111";
const self = { code, attributed: false, profileVerified: false };
function enabled() {
  vi.stubEnv("ENVOI_GATE2_REFERRAL_ENABLED", "true");
  vi.stubEnv("ENVOI_APP_ORIGIN", origin);
  getClaims.mockResolvedValue({ data: { claims: { sub: "respondent-user" } }, error: null });
  rpc.mockResolvedValue({ data: self, error: null });
}
function post(value: unknown = { code }, requestOrigin = origin) {
  return POST(new NextRequest(`${origin}/api/respondent/referral`, {
    method: "POST", body: JSON.stringify(value),
    headers: { origin: requestOrigin, "content-type": "application/json" },
  }));
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("self-service referral entry", () => {
  it("is default-off, hides other users and limits cross-origin input", async () => {
    expect((await GET(new NextRequest(`${origin}/api/respondent/referral`))).status).toBe(404);
    expect((await post()).status).toBe(404);
    enabled();
    expect((await post({ code }, "https://other.test")).status).toBe(403);
    expect((await post({ code: "guess" })).status).toBe(400);
    getClaims.mockResolvedValueOnce({ data: null, error: { message: "expired" } });
    expect((await GET(new NextRequest(`${origin}/api/respondent/referral`))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reads the private own code and registers then verifies a completed profile", async () => {
    enabled();
    const read = await GET(new NextRequest(`${origin}/api/respondent/referral`));
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    expect(await read.json()).toEqual(self);
    rpc.mockReset().mockResolvedValueOnce({ data: code, error: null })
      .mockResolvedValueOnce({ data: { verifiedCount: 1 }, error: null })
      .mockResolvedValueOnce({ data: { ...self, attributed: true,
        profileVerified: true }, error: null });
    const registered = await post();
    expect(registered.status).toBe(200);
    expect(await registered.json()).toEqual({ ...self, attributed: true,
      profileVerified: true });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "register_gate2_referral", "verify_gate2_referred_profile",
      "read_gate2_referral_self",
    ]);
  });
  it("leaves an incomplete friend attributed but unverified and never pays a bonus", async () => {
    enabled();
    rpc.mockReset().mockResolvedValueOnce({ data: code, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "23514" } })
      .mockResolvedValueOnce({ data: { ...self, attributed: true }, error: null });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ attributed: true,
      profileVerified: false });
  });
  it("carries a valid code through signup in a short-lived private cookie", async () => {
    enabled();
    const response = await VISIT(new NextRequest(`${origin}/r/ref/${code}`),
      { params: Promise.resolve({ code }) });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${origin}/r/signup`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=604800");
  });
});
