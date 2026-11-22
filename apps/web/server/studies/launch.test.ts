import { describe, expect, it, vi } from "vitest";
import { allowsTestLaunch, launchGate1Study } from "./launch";

const researcher = { id: "researcher-id", organizationId: "organization-id" };
const request = { studyId: "99000000-0000-4000-8000-000000000001", skip_payment: true };

describe("Gate 1 launch", () => {
  it("requires an explicit setting in a preview or on loopback", () => {
    const local = { NODE_ENV: "test" as const, ENVOI_APP_ORIGIN: "http://127.0.0.1:3100" };
    const preview = { ...local, ENVOI_APP_ORIGIN: "https://preview.example.test", VERCEL_ENV: "preview" };
    expect(allowsTestLaunch(local)).toBe(false);
    expect(allowsTestLaunch({ ...local, ENVOI_GATE1_TEST_LAUNCH: "1" })).toBe(true);
    expect(allowsTestLaunch({ ...preview, ENVOI_GATE1_TEST_LAUNCH: "1" })).toBe(true);
    expect(allowsTestLaunch({ ...preview, VERCEL_ENV: "production", ENVOI_GATE1_TEST_LAUNCH: "1" })).toBe(false);
    expect(allowsTestLaunch({ ...local, ENVOI_APP_ORIGIN: "https://example.test", ENVOI_GATE1_TEST_LAUNCH: "1" })).toBe(false);
  });

  it("takes tenant scope from the verified researcher and returns the persisted result", async () => {
    const study = { studyId: request.studyId, state: "fielding" };
    const rpc = vi.fn().mockResolvedValue({ data: study, error: null });
    await expect(launchGate1Study({ rpc }, researcher, request)).resolves.toEqual({ status: 200, study });
    expect(rpc).toHaveBeenCalledWith("launch_gate1_study", {
      supplied_researcher_id: researcher.id,
      supplied_organization_id: researcher.organizationId,
      supplied_study_id: request.studyId,
    });
  });

  it("validates the frozen launch request before using the database", async () => {
    const rpc = vi.fn();
    await expect(launchGate1Study({ rpc }, researcher, { ...request, skip_payment: false })).resolves.toEqual({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([["42501", 404], ["P0002", 409], ["23514", 409], ["XX000", 503]])(
    "handles SQL state %s with status %i", async (code, status) => {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { code } });
      await expect(launchGate1Study({ rpc }, researcher, request)).resolves.toEqual({ status });
    },
  );
});
