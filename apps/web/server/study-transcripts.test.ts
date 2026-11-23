import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "../app/api/researcher/studies/[studyId]/transcripts/route";

const { getClaims, from, rpc } = vi.hoisted(() => ({ getClaims: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: { auth: { getClaims }, from, rpc }, commit: (response: Response) => response }),
}));

const studyId = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
function get(study = studyId, search = "") {
  return GET(new NextRequest(`http://localhost:3000/api/researcher/studies/${study}/transcripts${search}`), {
    params: Promise.resolve({ studyId: study }),
  });
}

afterEach(() => vi.resetAllMocks());

it("rejects pre-MFA requests before looking for transcripts", async () => {
  getClaims.mockResolvedValue({ data: { claims: { aal: "aal1" } }, error: null });
  expect((await get()).status).toBe(403);
  expect((await get(studyId, "?version=2")).status).toBe(403);
  expect(from).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});

it("selects only the protected projection and keeps the response private", async () => {
  getClaims.mockResolvedValue({ data: { claims: { aal: "aal2" } }, error: null });
  const query = { select: vi.fn(), eq: vi.fn(), not: vi.fn(), order: vi.fn() };
  from.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.not.mockReturnValue(query);
  query.order.mockReturnValueOnce(query).mockResolvedValueOnce({
    data: [{ id, redacted_text: "Published fixture", raw_text: "Out-of-contract fixture" }], error: null,
  });

  expect((await get("invalid")).status).toBe(404);
  expect(from).not.toHaveBeenCalled();
  const response = await get();
  expect(from).toHaveBeenCalledExactlyOnceWith("transcripts");
  expect(query.select).toHaveBeenCalledExactlyOnceWith("id, redacted_text");
  expect(query.eq).toHaveBeenCalledExactlyOnceWith("study_id", studyId);
  expect(query.not).toHaveBeenCalledExactlyOnceWith("redacted_text", "is", null);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ studyId, transcripts: [{ id, redactedText: "Published fixture" }] });
});

it("returns grouped redacted rows through the dedicated private projection", async () => {
  getClaims.mockResolvedValue({ data: { claims: { aal: "aal2" } }, error: null });
  rpc.mockResolvedValue({ data: [
    { id, respondent_number: 2, student: false, redacted_text: "First", raw_text: "Out of contract" },
    { id: studyId, respondent_number: 2, student: false, redacted_text: "Second" },
    { id, respondent_number: 4, student: null, redacted_text: "Third" },
  ], error: null });

  const response = await get(studyId, "?version=2");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(rpc).toHaveBeenCalledExactlyOnceWith("read_gate1_researcher_transcripts", { supplied_study_id: studyId });
  expect(from).not.toHaveBeenCalled();
  expect(await response.json()).toEqual({ studyId, respondents: [
    { number: 2, student: false, transcripts: [{ id, redactedText: "First" }, { id: studyId, redactedText: "Second" }] },
    { number: 4, student: null, transcripts: [{ id, redactedText: "Third" }] },
  ] });
});
