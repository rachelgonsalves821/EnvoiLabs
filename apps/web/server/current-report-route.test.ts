import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/researcher/studies/[studyId]/report/route";

const { getClaims, rpc } = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth/supabase", async (original) => ({
  ...await original<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: { auth: { getClaims }, rpc },
    commit: (response: Response) => response }),
}));

const studyId = "90600000-0000-4000-8000-000000000001";
const reportId = "a9700000-0000-4000-8000-000000000006";
const summary = { version: 2, executiveAnswer: "A qualified finding",
  hypotheses: [], themes: [] };
const request = (id = studyId) => GET(new NextRequest(
  `https://labs.example.test/api/researcher/studies/${id}/report`),
  { params: Promise.resolve({ studyId: id }) });
afterEach(() => vi.resetAllMocks());

describe("current-qualified researcher report route", () => {
  it("requires AAL2 before any report database read", async () => {
    getClaims.mockResolvedValue({ data: { claims: { aal: "aal1" } }, error: null });
    expect((await request()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns only the current qualified summary with private no-store headers", async () => {
    getClaims.mockResolvedValue({ data: { claims: { aal: "aal2" } }, error: null });
    rpc.mockResolvedValue({ data: { report: { id: reportId, studyId,
      summary, privateRationale: "never expose" }, rawAudio: "private" }, error: null });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.json()).toEqual({ reportId, studyId, summary });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "read_gate3_current_qualified_report", { supplied_study_id: studyId });
  });
  it("does not fall back after a newer version is withheld or access changes", async () => {
    getClaims.mockResolvedValue({ data: { claims: { aal: "aal2" } }, error: null });
    rpc.mockResolvedValueOnce({ data: { report: { id: reportId, studyId,
      summary } }, error: null }).mockResolvedValueOnce({ data: null, error: null });
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(404);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("rejects invalid study, wrong-study report and malformed qualified text", async () => {
    getClaims.mockResolvedValue({ data: { claims: { aal: "aal2" } }, error: null });
    expect((await request("invalid")).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: { report: { id: reportId,
      studyId: "90600000-0000-4000-8000-000000000099", summary } }, error: null })
      .mockResolvedValueOnce({ data: { report: { id: reportId, studyId,
        summary: { ...summary, privateRationale: "private" } } }, error: null });
    expect((await request()).status).toBe(404);
    expect((await request()).status).toBe(404);
  });
  it("fails closed on report read outage", async () => {
    getClaims.mockResolvedValue({ data: { claims: { aal: "aal2" } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { code: "500" } });
    expect((await request()).status).toBe(503);
  });
});
