import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startAudioUpload } from "./private-audio";

const calls = vi.hoisted(() => ({ reserve: vi.fn(), sign: vi.fn(), claims: vi.fn(), commit: vi.fn() }));
const userId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const guideQuestionId = "00000000-0000-4000-8000-000000000003";

vi.mock("../auth/supabase", () => ({
  appOrigin: () => "https://example.test",
  privateHeaders: { "Cache-Control": "private, no-store" },
  requestSession: () => ({ client: { auth: { getClaims: calls.claims }, rpc: calls.reserve },
    commit: calls.commit }),
  trustedClient: () => ({ storage: { from: () => ({ createSignedUploadUrl: calls.sign }) } }),
}));

function request(body: object) {
  return new NextRequest("https://example.test/api/respondent/answers/upload", {
    method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Gate 4 upload reservation boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    calls.claims.mockResolvedValue({ data: { claims: { sub: userId } }, error: null });
    calls.commit.mockImplementation((response: Response) => response);
  });

  it("denies before reserving or signing and passes the authenticated subject as key", async () => {
    const check = vi.fn(async () => ({ kind: "limited" as const, retryAfterSeconds: 22 }));
    const result = await startAudioUpload(request({ sessionId, guideQuestionId, bytes: 1024,
      mime: "audio/webm" }), check);
    expect(result.status).toBe(429);
    expect(result.headers.get("Retry-After")).toBe("22");
    expect(check).toHaveBeenCalledWith(expect.any(NextRequest), "audio-upload", userId);
    expect(calls.reserve).not.toHaveBeenCalled();
    expect(calls.sign).not.toHaveBeenCalled();
    expect(calls.commit).not.toHaveBeenCalled();
  });

  it("does not reveal quota state for invalid or unauthenticated requests", async () => {
    const check = vi.fn(async () => ({ kind: "limited" as const, retryAfterSeconds: 22 }));
    expect((await startAudioUpload(request({ sessionId, guideQuestionId, bytes: 0,
      mime: "audio/webm" }), check)).status).toBe(400);
    calls.claims.mockResolvedValue({ data: null, error: null });
    expect((await startAudioUpload(request({ sessionId, guideQuestionId, bytes: 1024,
      mime: "audio/webm" }), check)).status).toBe(401);
    expect(check).not.toHaveBeenCalled();
  });
});
