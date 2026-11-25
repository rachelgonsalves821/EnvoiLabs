import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/researcher/studies/[studyId]/quality/route";

const { getClaims, researcherRow, studyRow, decide } = vi.hoisted(() => ({
  getClaims: vi.fn(), researcherRow: vi.fn(), studyRow: vi.fn(), decide: vi.fn(),
}));
vi.mock("./auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: { auth: { getClaims }, from: (table: string) => {
    const final = table === "researchers" ? researcherRow : studyRow;
    const query = { select: () => query, eq: () => query, maybeSingle: final };
    return query;
  } }, commit: (response: Response) => response }),
  trustedClient: () => ({ rpc: decide }),
}));

const origin = "https://labs.example.test";
const studyId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
const approved = { quoteId, sessionId, decision: "approve", score: 87,
  components: { completion: 90, coherence: 84 } };
function post(body: unknown = approved, requestOrigin = origin) {
  return POST(new NextRequest(`${origin}/api/researcher/studies/${studyId}/quality`, {
    method: "POST", body: JSON.stringify(body),
    headers: { origin: requestOrigin, "content-type": "application/json" },
  }), { params: Promise.resolve({ studyId }) });
}
function authorized() {
  vi.stubEnv("ENVOI_GATE2_QUALITY_REVIEW_ENABLED", "true");
  vi.stubEnv("ENVOI_APP_ORIGIN", origin);
  getClaims.mockResolvedValue({ data: { claims: { aal: "aal2", sub: actorId } }, error: null });
  researcherRow.mockResolvedValue({ data: { id: actorId,
    organization_id: studyId }, error: null });
  studyRow.mockResolvedValue({ data: { id: studyId }, error: null });
  decide.mockResolvedValue({ data: { sessionId, decision: "approve",
    replacement: null }, error: null });
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("reviewed marketplace quality route", () => {
  it("is off by default and rejects cross-origin or unbounded content", async () => {
    expect((await post()).status).toBe(404);
    authorized();
    expect((await post(approved, "https://other.example.test")).status).toBe(403);
    expect((await post({ ...approved, score: 101 })).status).toBe(400);
    expect((await post({ ...approved, components: { rationale: "private text" } })).status)
      .toBe(400);
    expect((await post({ ...approved, reason: "unexpected" })).status).toBe(400);
    expect(decide).not.toHaveBeenCalled();
  });

  it("requires MFA and current study organization before the privileged decision", async () => {
    authorized();
    getClaims.mockResolvedValueOnce({ data: { claims: { aal: "aal1", sub: actorId } },
      error: null });
    expect((await post()).status).toBe(403);
    researcherRow.mockResolvedValueOnce({ data: null, error: null });
    expect((await post()).status).toBe(403);
    studyRow.mockResolvedValueOnce({ data: null, error: null });
    expect((await post()).status).toBe(404);
    expect(decide).not.toHaveBeenCalled();
  });

  it("records an explicit approved decision with a private, bounded response", async () => {
    authorized();
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ sessionId,
      decision: "approve", replacementCreated: 0 });
    expect(decide).toHaveBeenCalledWith("decide_gate2_marketplace_quality", {
      supplied_study_id: studyId, supplied_quote_id: quoteId,
      supplied_session_id: sessionId, supplied_actor_auth_id: actorId,
      supplied_decision: "approve", supplied_score: 87,
      supplied_components: { completion: 90, coherence: 84 }, supplied_reason: null,
    });
  });

  it("requires a removal reason and treats policy refusal distinctly from outage", async () => {
    authorized();
    expect((await post({ ...approved, decision: "remove" })).status).toBe(400);
    const removed = { ...approved, decision: "remove",
      reason: "Reviewed answer failed the study quality criterion." };
    decide.mockResolvedValueOnce({ data: { sessionId, decision: "remove",
      replacement: { created: 1 } }, error: null });
    const response = await post(removed);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId,
      decision: "remove", replacementCreated: 1 });
    decide.mockResolvedValueOnce({ data: null, error: { code: "23514" } });
    expect((await post(removed)).status).toBe(409);
    decide.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    expect((await post(removed)).status).toBe(503);
  });
});
