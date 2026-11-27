import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/researcher/studies/[studyId]/report/route";

const { getClaims, from, rpc, commit } = vi.hoisted(() => ({
  getClaims: vi.fn(), from: vi.fn(), rpc: vi.fn(), commit: vi.fn((response) => response),
}));
vi.mock("./auth/supabase", async (original) => ({
  ...await original<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: { auth: { getClaims }, from, rpc }, commit }),
}));

const studyId = "90600000-0000-4000-8000-000000000001";
const reportId = "a9700000-0000-4000-8000-000000000006";
const organizationId = "a9700000-0000-4000-8000-000000000010";
const summary = { version: 2, executiveAnswer: "Fictional qualified answer",
  themes: [], hypotheses: [] };
function request(id = studyId) {
  return GET(new NextRequest(`https://preview.example.test/api/researcher/studies/${id}/report`),
    { params: Promise.resolve({ studyId: id }) });
}
function authorized(study: { id: string } | null = { id: studyId }) {
  getClaims.mockResolvedValue({ data: { claims: { sub: "researcher-fixture", aal: "aal2" } },
    error: null });
  const researcher = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn()
    .mockResolvedValue({ data: { organization_id: organizationId }, error: null }) };
  researcher.select.mockReturnValue(researcher);
  researcher.eq.mockReturnValue(researcher);
  const scopedStudy = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn()
    .mockResolvedValue({ data: study, error: null }) };
  scopedStudy.select.mockReturnValue(scopedStudy);
  scopedStudy.eq.mockReturnValue(scopedStudy);
  from.mockImplementation((table) => table === "researchers" ? researcher : scopedStudy);
  return { researcher, scopedStudy };
}
afterEach(() => vi.resetAllMocks());

describe("Gate 5 current-qualified report route", () => {
  it("denies pre-MFA, missing researcher and other tenant before qualified read", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "r", aal: "aal1" } }, error: null });
    expect((await request()).status).toBe(403);
    expect(from).not.toHaveBeenCalled();
    authorized();
    const researcher = from("researchers");
    researcher.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await request()).status).toBe(403);
    authorized(null);
    expect((await request()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns only strict public V2 data with private headers and current RPC", async () => {
    const { researcher, scopedStudy } = authorized();
    rpc.mockResolvedValue({ data: { report: { id: reportId, studyId, summary,
      privateRationale: "never publish" }, rawAudio: "private" }, error: null });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.json()).toEqual({ reportId, studyId, summary });
    expect(researcher.eq).toHaveBeenCalledWith("auth_user_id", "researcher-fixture");
    expect(scopedStudy.eq).toHaveBeenCalledWith("organization_id", organizationId);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_gate3_current_qualified_report",
      { supplied_study_id: studyId });
    expect(commit).toHaveBeenCalledOnce();
  });
  it("rechecks each read and withholds a revoked or replaced current report", async () => {
    authorized();
    rpc.mockResolvedValueOnce({ data: { report: { id: reportId, studyId, summary } }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    expect((await request()).status).toBe(200);
    const withheld = await request();
    expect(withheld.status).toBe(404);
    expect(withheld.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("fails closed on malformed request, wrong study, private summary or outage", async () => {
    authorized();
    expect((await request("bad")).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: { report: { id: reportId,
      studyId: "90600000-0000-4000-8000-000000000099", summary } }, error: null })
      .mockResolvedValueOnce({ data: { report: { id: reportId, studyId,
        summary: { ...summary, privateRationale: "private" } } }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "500" } });
    expect((await request()).status).toBe(404);
    expect((await request()).status).toBe(404);
    expect((await request()).status).toBe(503);
  });
  it("commits a private generic 503 when claims, scope queries or params throw", async () => {
    const check = async (response: Response) => {
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(await response.json()).toEqual({ ok: false });
      expect(commit).toHaveBeenCalledOnce();
      expect(rpc).not.toHaveBeenCalled();
      vi.clearAllMocks();
    };
    getClaims.mockRejectedValueOnce(new Error("private claims failure"));
    await check(await request());

    const { researcher } = authorized();
    researcher.maybeSingle.mockRejectedValueOnce(new Error("private researcher failure"));
    await check(await request());

    const { scopedStudy } = authorized();
    scopedStudy.maybeSingle.mockRejectedValueOnce(new Error("private study failure"));
    await check(await request());

    authorized();
    await check(await GET(new NextRequest(
      `https://preview.example.test/api/researcher/studies/${studyId}/report`),
      { params: Promise.reject(new Error("private params failure")) }));
  });
});
