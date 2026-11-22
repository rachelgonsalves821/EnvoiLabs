import { readGate1StudyTracking } from "@envoi-labs/services/study-tracking";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/researcher/studies/[studyId]/tracking/route";

const { getClaims, rpc } = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("./auth/supabase")>(),
  requestSession: () => ({
    client: { auth: { getClaims }, rpc },
    commit: (response: Response) => response,
  }),
}));

const studyId = "11111111-1111-4111-8111-111111111111";
const tracking = { studyId, state: "fielding", invited: 3, accepted: 2, completed: 1, removed: 0, projectedFinish: null };
const study = { title: "Delivery study", targetCompletes: 3 };

function get() {
  return GET(new NextRequest(`http://localhost:3000/api/researcher/studies/${studyId}/tracking`), {
    params: Promise.resolve({ studyId }),
  });
}

afterEach(() => { vi.resetAllMocks(); });

describe("Gate 1 study tracking", () => {
  it("does not query tracking without an authenticated researcher session", async () => {
    getClaims.mockResolvedValue({ data: { claims: { aal: "aal1" } }, error: null });
    expect((await get()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns the frozen tracking shape with private cache headers", async () => {
    getClaims.mockResolvedValue({ data: { claims: { aal: "aal2" } }, error: null });
    rpc.mockResolvedValue({ data: { ...tracking, ...study }, error: null });
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(tracking);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_gate1_study_tracking", { supplied_study_id: studyId });
  });

  it("treats an unknown or inaccessible study as missing and fails closed on unexpected projection data", async () => {
    const rpc = vi.fn();
    expect(await readGate1StudyTracking({ rpc }, "invalid")).toEqual({ status: 404 });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await readGate1StudyTracking({ rpc }, studyId)).toEqual({ status: 404 });
    rpc.mockResolvedValueOnce({ data: { ...tracking, ...study, respondentId: "private" }, error: null });
    expect(await readGate1StudyTracking({ rpc }, studyId)).toEqual({ status: 503 });
  });
});
