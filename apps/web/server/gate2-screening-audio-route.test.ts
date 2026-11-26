import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST, PUT } from "../app/api/respondent/screening/[inviteId]/audio/route";

const { getClaims, respondentRpc, serviceRpc, signUpload, download } = vi.hoisted(() => ({
  getClaims: vi.fn(), respondentRpc: vi.fn(), serviceRpc: vi.fn(),
  signUpload: vi.fn(), download: vi.fn(),
}));
vi.mock("./auth/supabase", async (original) => ({
  ...await original<typeof import("./auth/supabase")>(),
  requestSession: () => ({ client: { auth: { getClaims }, rpc: respondentRpc },
    commit: (response: Response) => response }),
  trustedClient: () => ({ rpc: serviceRpc, storage: { from: () => ({
    createSignedUploadUrl: signUpload, download,
  }) } }),
}));

const origin = "https://labs.example.test";
const inviteId = "11111111-1111-4111-8111-111111111111";
const ruleId = "22222222-2222-4222-8222-222222222222";
const audioObjectId = "33333333-3333-4333-8333-333333333333";
const ownerId = "44444444-4444-4444-8444-444444444444";
const bytes = Buffer.from("1a45dfa3", "hex");
const context = { params: Promise.resolve({ inviteId }) };
function request(method: "POST" | "PUT", body: unknown, from = origin) {
  return new NextRequest(`${origin}/api/respondent/screening/${inviteId}/audio`, {
    method, body: JSON.stringify(body), headers: { origin: from,
      "content-type": "application/json" },
  });
}
function enable() {
  vi.stubEnv("ENVOI_GATE2_SCREENING_VOICE_ENABLED", "true");
  vi.stubEnv("ENVOI_APP_ORIGIN", origin);
  getClaims.mockResolvedValue({ data: { claims: { sub: "respondent-user" } }, error: null });
  respondentRpc.mockImplementation(async (name: string) => ({ data:
    name === "reserve_gate2_screening_audio" ? { audioObjectId, expiresAt: "2026-11-26T13:00:00Z" } :
      { ownerId, bytes: bytes.length, mime: "audio/webm", ruleId, ruleVersion: 1 },
  error: null }));
  signUpload.mockResolvedValue({ data: { signedUrl: `${origin}/private-upload` }, error: null });
  download.mockResolvedValue({ data: new Blob([bytes], { type: "audio/webm" }), error: null });
  serviceRpc.mockResolvedValue({ data: { audioObjectId, status: "queued" }, error: null });
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("private screening audio upload", () => {
  it("defaults off and rejects malformed or foreign-origin requests", async () => {
    expect((await POST(request("POST", { ruleId, ruleVersion: 1,
      bytes: bytes.length, mime: "audio/webm" }), context)).status).toBe(404);
    enable();
    expect((await POST(request("POST", { ruleId, ruleVersion: 1,
      bytes: bytes.length, mime: "audio/webm" }, "https://other.test"), context)).status).toBe(403);
    expect((await POST(request("POST", { ruleId, ruleVersion: 1,
      bytes: bytes.length, mime: "video/webm" }), context)).status).toBe(400);
    expect(respondentRpc).not.toHaveBeenCalled();
  });
  it("reserves an owned consented path and signs only that path", async () => {
    enable();
    const result = await POST(request("POST", { ruleId, ruleVersion: 1,
      bytes: bytes.length, mime: "audio/webm" }), context);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(signUpload).toHaveBeenCalledWith(`screening/${inviteId}/${audioObjectId}`,
      { upsert: false });
    expect(respondentRpc).toHaveBeenCalledWith("reserve_gate2_screening_audio", {
      supplied_invite_id: inviteId, supplied_rule_id: ruleId, supplied_version: 1,
      supplied_bytes: bytes.length, supplied_mime: "audio/webm",
    });
  });
  it("verifies stored bytes before a service-only confirmation", async () => {
    enable();
    const body = { audioObjectId, durationMs: 5000 };
    download.mockResolvedValueOnce({ data: new Blob(["not webm"],
      { type: "audio/webm" }), error: null });
    expect((await PUT(request("PUT", body), context)).status).toBe(409);
    expect(serviceRpc).not.toHaveBeenCalled();
    const result = await PUT(request("PUT", body), context);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: "queued" });
    expect(serviceRpc).toHaveBeenCalledWith("confirm_gate2_screening_audio", {
      supplied_owner_id: ownerId, supplied_invite_id: inviteId,
      supplied_audio_id: audioObjectId, supplied_duration_ms: 5000,
      supplied_sha256: "5fd872525fa77d054b86ca7b50927b4d1f860b21ab2b166fdf6c3ed3c4b5d0bc",
    });
  });
});
