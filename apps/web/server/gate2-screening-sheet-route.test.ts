import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/respondent/screening/[inviteId]/route";

const { getClaims, rpc } = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: { auth: { getClaims }, rpc },
    commit: (response: Response) => response }),
}));

const origin = "https://labs.example.test";
const inviteId = "11111111-1111-4111-8111-111111111111";
const studyId = "22222222-2222-4222-8222-222222222222";
const ruleId = "33333333-3333-4333-8333-333333333333";
const key = "gate2-screen:44444444-4444-4444-8444-444444444444";
const body = { ruleId, ruleVersion: 1, text: "I worked there last year.", key };
function get() { return GET(new NextRequest(`${origin}/api/respondent/screening/${inviteId}`),
  { params: Promise.resolve({ inviteId }) }); }
function post(value: unknown = body, requestOrigin = origin) {
  return POST(new NextRequest(`${origin}/api/respondent/screening/${inviteId}`, {
    method: "POST", body: JSON.stringify(value), headers: {
      origin: requestOrigin, "content-type": "application/json",
    },
  }), { params: Promise.resolve({ inviteId }) });
}
function enabled() {
  vi.stubEnv("ENVOI_GATE2_SCREENING_SHEET_ENABLED", "true");
  vi.stubEnv("ENVOI_APP_ORIGIN", origin);
  getClaims.mockResolvedValue({ data: { claims: { sub: "respondent-user" } }, error: null });
  rpc.mockResolvedValue({ data: { inviteId, studyId, state: "screening",
    expiresAt: "2026-11-25T12:00:00Z", questions: [{ ruleId, ruleVersion: 1,
      question: "Have you worked there?", status: "unanswered" }] }, error: null });
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("private typed screening sheet", () => {
  it("stays off and limits cross-origin or malformed writes", async () => {
    expect((await get()).status).toBe(404);
    expect((await post()).status).toBe(404);
    enabled();
    expect((await post(body, "https://other.test")).status).toBe(403);
    expect((await post({ ...body, text: "" })).status).toBe(400);
    expect((await post({ ...body, kind: "voice" })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns only the owned approved question and hides a foreign invite", async () => {
    enabled();
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).questions[0]).toEqual({ ruleId,
      ruleVersion: 1, question: "Have you worked there?", status: "unanswered" });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await get()).status).toBe(404);
    rpc.mockResolvedValueOnce({ data: { inviteId, studyId, state: "screening",
      expiresAt: "2026-11-25T12:00:00Z", questions: [{ ruleId,
        ruleVersion: 1, question: "Q", status: "unknown" }] }, error: null });
    expect((await get()).status).toBe(503);
  });
  it("returns an owned status-only screened-out result without answer details", async () => {
    enabled();
    rpc.mockResolvedValueOnce({ data: { inviteId, studyId, state: "screened_out",
      expiresAt: "2026-11-25T12:00:00Z", questions: [] }, error: null });
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ inviteId, studyId,
      state: "screened_out", expiresAt: "2026-11-25T12:00:00Z", questions: [] });
    rpc.mockResolvedValueOnce({ data: { inviteId, studyId, state: "screened_out",
      expiresAt: "2026-11-25T12:00:00Z", questions: [{ ruleId,
        ruleVersion: 1, question: "Private question", status: "screen_out" }] }, error: null });
    expect((await get()).status).toBe(503);
  });
  it("stores typed answers as pending review with no model or qualification", async () => {
    enabled();
    rpc.mockResolvedValueOnce({ data: { inviteId, ruleId, ruleVersion: 1,
      status: "pending_review" }, error: null });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "pending_review" });
    expect(rpc).toHaveBeenCalledWith("submit_gate2_screening_text", {
      supplied_invite_id: inviteId, supplied_rule_id: ruleId,
      supplied_version: 1, supplied_text: body.text, supplied_key: key,
    });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23514" } });
    expect((await post()).status).toBe(409);
    getClaims.mockResolvedValueOnce({ data: null, error: { message: "expired" } });
    expect((await post()).status).toBe(403);
  });
});
