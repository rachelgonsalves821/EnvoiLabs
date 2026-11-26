import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/respondent/probes/render-error/route";

const { getClaims, rpc } = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth/supabase", async (original) => ({
  ...await original<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: { auth: { getClaims } },
    commit: (response: Response) => response }),
  trustedClient: () => ({ rpc }),
}));

const sessionId = "a9720000-0000-4000-8000-000000000004";
const turnId = "a9720000-0000-4000-8000-000000000007";
const probeId = "a9720000-0000-4000-8000-000000000008";
const actorId = "90300000-0000-4000-8000-000000000001";
function post(body: object = { sessionId, turnId, probeId }) {
  return POST(new NextRequest("https://labs.example.test/api/respondent/probes/render-error", {
    method: "POST", body: JSON.stringify(body), headers: {
      origin: "https://labs.example.test", "content-type": "application/json",
    },
  }));
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("respondent probe render failure receipt", () => {
  it("requires identity and exact IDs before the privileged write", async () => {
    vi.stubEnv("ENVOI_APP_ORIGIN", "https://labs.example.test");
    getClaims.mockResolvedValue({ data: { claims: {} }, error: null });
    expect((await post()).status).toBe(401);
    getClaims.mockResolvedValue({ data: { claims: { sub: actorId } }, error: null });
    expect((await post({ sessionId, turnId, probeId: "wrong" })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("records only the database result and fails closed on stale or failed writes", async () => {
    vi.stubEnv("ENVOI_APP_ORIGIN", "https://labs.example.test");
    getClaims.mockResolvedValue({ data: { claims: { sub: actorId } }, error: null });
    rpc.mockResolvedValueOnce({ data: { status: "resolved", outcome: "error", turnId },
      error: null });
    const recorded = await post();
    expect(recorded.status).toBe(200);
    expect(await recorded.json()).toEqual({ status: "resolved", outcome: "error" });
    expect(rpc).toHaveBeenCalledWith("record_gate3_probe_render_error", {
      supplied_session_id: sessionId, supplied_turn_id: turnId,
      supplied_probe_id: probeId, supplied_auth_user_id: actorId,
    });
    rpc.mockResolvedValueOnce({ data: { status: "stale" }, error: null });
    expect((await post()).status).toBe(409);
    rpc.mockResolvedValueOnce({ data: null, error: Error("offline") });
    expect((await post()).status).toBe(503);
  });
});
