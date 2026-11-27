import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startInterview } from "./interview-start";

const { sessionRpc, trustedRpc, commit } = vi.hoisted(() => ({
  sessionRpc: vi.fn(), trustedRpc: vi.fn(), commit: vi.fn((value: Response) => value),
}));
vi.mock("../auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("../auth/supabase")>(),
  requestSession: () => ({ client: {
    auth: { getClaims: async () => ({ data: { claims: { sub: respondentId } }, error: null }) },
    rpc: sessionRpc,
  }, commit }),
  trustedClient: () => ({ rpc: trustedRpc }),
}));

const sessionId = "019ac928-4718-7b62-b72d-8c9fb79b337c";
const respondentId = "019ac928-4718-7b62-b72d-8c9fb79b337d";
const inviteId = "019ac928-4718-7b62-b72d-8c9fb79b337e";
const session = { sessionId,
  progress: { sessionId, currentQuestion: 2, coreQuestionCount: 4, rewardCents: 100 },
  nextQuestion: { id: inviteId, text: "What happened next?" },
  expiresAt: "2026-11-27T18:00:00.000Z" };
function request() {
  return new NextRequest("https://labs.example.test/api/respondent/sessions/start", {
    method: "POST", body: JSON.stringify({ inviteId }),
    headers: { origin: "https://labs.example.test", "content-type": "application/json" },
  });
}

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("current respondent probe decision state", () => {
  it("holds the planned question only for a current pending answer", async () => {
    vi.stubEnv("ENVOI_APP_ORIGIN", "https://labs.example.test");
    vi.stubEnv("ENVOI_GATE3_PROBE_DISPATCH_ENABLED", "true");
    sessionRpc.mockResolvedValue({ data: session, error: null });
    trustedRpc.mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const response = await startInterview(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ probePending: true,
      nextQuestion: session.nextQuestion, currentProbe: null });
    expect(trustedRpc).toHaveBeenNthCalledWith(2, "read_gate3_probe_pending", {
      supplied_session_id: sessionId, supplied_auth_user_id: respondentId });
    expect(commit).toHaveBeenCalledOnce();
  });

  it("does not poll a pending decision when a committed probe is current", async () => {
    vi.stubEnv("ENVOI_APP_ORIGIN", "https://labs.example.test");
    vi.stubEnv("ENVOI_GATE3_PROBE_DISPATCH_ENABLED", "true");
    sessionRpc.mockResolvedValue({ data: session, error: null });
    trustedRpc.mockResolvedValue({ data: {
      turnId: sessionId, probeId: inviteId, text: "Why did speed matter?",
    }, error: null });
    const response = await startInterview(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ probePending: false,
      currentProbe: { probeId: inviteId } });
    expect(trustedRpc).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the pending read is unavailable", async () => {
    vi.stubEnv("ENVOI_APP_ORIGIN", "https://labs.example.test");
    vi.stubEnv("ENVOI_GATE3_PROBE_DISPATCH_ENABLED", "true");
    sessionRpc.mockResolvedValue({ data: session, error: null });
    trustedRpc.mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    const response = await startInterview(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: false });
    expect(commit).toHaveBeenCalledOnce();
  });
});
