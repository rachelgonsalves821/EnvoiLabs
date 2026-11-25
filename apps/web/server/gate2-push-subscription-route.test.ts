import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST, DELETE } from "../app/api/respondent/push-subscription/route";

const { getClaims, rpc } = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: { auth: { getClaims }, rpc },
    commit: (response: Response) => response }),
}));

const origin = "https://labs.example.test";
const endpoint = "https://push.example.test/subscription/1";
const body = { endpoint, p256dh: "A".repeat(86), auth: "B".repeat(22) };
function request(method: "POST" | "DELETE", value: unknown = body,
  requestOrigin = origin) {
  return new NextRequest(`${origin}/api/respondent/push-subscription`, {
    method, body: JSON.stringify(value), headers: {
      origin: requestOrigin, "content-type": "application/json",
    },
  });
}
function enabled() {
  vi.stubEnv("ENVOI_GATE2_PUSH_REGISTRATION_ENABLED", "true");
  vi.stubEnv("ENVOI_APP_ORIGIN", origin);
  getClaims.mockResolvedValue({ data: { claims: { sub: "respondent-user" } }, error: null });
  rpc.mockResolvedValue({ data: true, error: null });
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("private push subscription registration", () => {
  it("is off by default and rejects cross-origin and invalid endpoints before an RPC", async () => {
    expect((await POST(request("POST"))).status).toBe(404);
    enabled();
    expect((await POST(request("POST", body, "https://other.test"))).status).toBe(403);
    expect((await POST(request("POST", { ...body, endpoint: "https://127.0.0.1/a" }))).status)
      .toBe(400);
    expect((await POST(request("POST", { ...body, auth: "short" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("uses the respondent session and a current consent-checked RPC", async () => {
    enabled();
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith("register_gate2_push_subscription", {
      supplied_endpoint: endpoint, supplied_p256dh: body.p256dh,
      supplied_auth: body.auth,
    });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23514" } });
    expect((await POST(request("POST"))).status).toBe(403);
    getClaims.mockResolvedValueOnce({ data: null, error: { message: "expired" } });
    expect((await POST(request("POST"))).status).toBe(403);
  });
  it("allows private removal after consent revocation", async () => {
    enabled();
    const response = await DELETE(request("DELETE", { endpoint }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("remove_gate2_push_subscription", {
      supplied_endpoint: endpoint,
    });
  });
});
