import type { CreateGate1StudyRequest } from "@envoi-labs/contracts";
import { gate1CriterionChoices } from "@envoi-labs/services/study-draft-criteria";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/researcher/studies/route";

const { getResearcher, rpc } = vi.hoisted(() => ({ getResearcher: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth/identity", () => ({ getResearcher }));
vi.mock("./auth/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("./auth/supabase")>(), trustedClient: () => ({ rpc }),
}));

const origin = "http://localhost:3000";
const studyId = "11111111-1111-4111-8111-111111111111";
const researcher = { id: "researcher", organizationId: "organization" };
const draft = {
  title: "Delivery study",
  targetCompletes: 5,
  coreQuestions: ["What did you order?", "What made you choose that?", "What happened next?", "How did you decide whether to order again?"],
  criteria: [
    { kind: "must", text: gate1CriterionChoices[0].text },
    { kind: "nice", text: gate1CriterionChoices[4].text },
  ],
} satisfies CreateGate1StudyRequest;

function post(body: unknown = draft, requestOrigin = origin) {
  vi.stubEnv("ENVOI_APP_ORIGIN", origin);
  return POST(new NextRequest(`${origin}/api/researcher/studies`, {
    method: "POST", body: JSON.stringify(body),
    headers: { origin: requestOrigin, "content-type": "application/json", "idempotency-key": studyId },
  }));
}

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("Gate 1 study draft route", () => {
  it("fails closed for other origins and sessions without researcher access", async () => {
    expect((await post(draft, "https://elsewhere.example")).status).toBe(403);
    expect(getResearcher).not.toHaveBeenCalled();
    getResearcher.mockResolvedValue(null);
    expect((await post()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid guides, tenant overrides and unsupported or repeated criterion labels", async () => {
    getResearcher.mockResolvedValue(researcher);
    for (const body of [
      { ...draft, coreQuestions: ["One question?"] },
      { ...draft, organizationId: "another organization" },
      { ...draft, criteria: [{ kind: "must", text: "Unknown" }, draft.criteria[1]] },
      { ...draft, criteria: [draft.criteria[0], draft.criteria[0]] },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the session's scope and compiles the approved criteria in one database operation", async () => {
    getResearcher.mockResolvedValue(researcher);
    rpc.mockResolvedValue({ data: { studyId, state: "draft" }, error: null });
    const result = await post();
    expect(result.status).toBe(201);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ studyId, state: "draft" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_gate1_study", {
      supplied_study_id: studyId,
      supplied_organization_id: researcher.organizationId,
      supplied_researcher_id: researcher.id,
      draft,
      predicates: [
        { ...gate1CriterionChoices[0], kind: "must" },
        { ...gate1CriterionChoices[4], kind: "nice" },
      ],
    });
  });

  it("requires confirmed database output before showing success", async () => {
    getResearcher.mockResolvedValue(researcher);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    expect((await post()).status).toBe(409);
    rpc.mockResolvedValueOnce({ data: { state: "draft" }, error: null });
    expect((await post()).status).toBe(503);
  });
});
