import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { researcherCallback, researcherMfa, researcherStart } from "./researcher";
import { respondentAuth } from "./respondent";

const calls = vi.hoisted(() => ({
  commit: vi.fn(), signIn: vi.fn(), verifyOtp: vi.fn(), enroll: vi.fn(),
  rpc: vi.fn(), maybeSingle: vi.fn(), getUser: vi.fn(), listFactors: vi.fn(),
}));
const origin = "https://example.test";
const userId = "00000000-0000-4000-8000-000000000001";
const phone = "+12025550123";

vi.mock("./supabase", () => ({
  appOrigin: () => "https://example.test",
  privateHeaders: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  requestSession: () => ({
    client: { auth: {
      signInWithOtp: calls.signIn, verifyOtp: calls.verifyOtp, getUser: calls.getUser,
      mfa: { enroll: calls.enroll, listFactors: calls.listFactors },
    } },
    commit: calls.commit,
  }),
  trustedClient: () => ({
    rpc: calls.rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: calls.maybeSingle }) }) }),
  }),
}));

function post(body: object, requestOrigin = origin) {
  return new NextRequest(origin, {
    method: "POST",
    headers: { Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("auth handlers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ENVOI_PHONE_DATA_KEY = Buffer.alloc(32, 7).toString("base64");
    calls.commit.mockImplementation((response: Response) => response);
    calls.signIn.mockResolvedValue({ error: null });
    calls.verifyOtp.mockResolvedValue({
      data: { user: { id: userId, email_confirmed_at: "2026-11-20" }, session: {} }, error: null,
    });
    calls.rpc.mockResolvedValue({ error: null });
    calls.maybeSingle.mockResolvedValue({ data: { id: userId }, error: null });
  });

  it("rejects cross-origin starts and missing attestation without sending a message", async () => {
    expect((await respondentAuth(post({ phone, ageAttested: true }, "https://untrusted.test"), false)).status).toBe(403);
    expect((await respondentAuth(post({ phone, ageAttested: false }), false)).status).toBe(400);
    expect(calls.signIn).not.toHaveBeenCalled();
  });

  it("stores a keyed phone digest and randomized ciphertext after OTP verification", async () => {
    for (const attempt of [1, 2]) {
      const result = await respondentAuth(post({ phone, ageAttested: true, code: "123456" }), true);
      expect(result.status).toBe(200);
      expect(calls.commit).toHaveBeenCalledTimes(attempt);
    }
    const first = calls.rpc.mock.calls[0]?.[1];
    const second = calls.rpc.mock.calls[1]?.[1];
    expect(first).toEqual({
      supplied_user_id: userId, supplied_ciphertext: expect.stringMatching(/^\\x01[\da-f]+$/),
      supplied_hash: expect.stringMatching(/^\\x[\da-f]{64}$/),
    });
    expect(first.supplied_ciphertext).not.toBe(second.supplied_ciphertext);
    expect(first.supplied_hash).toBe(second.supplied_hash);
    expect(JSON.stringify(first)).not.toContain(phone);
  });

  it("abandons pending session cookies when the phone is already bound to a different identity", async () => {
    calls.rpc.mockResolvedValueOnce({ error: { code: "23505" } });
    const result = await respondentAuth(post({ phone, ageAttested: true, code: "123456" }), true);
    expect(result.status).toBe(403);
    expect(calls.commit).not.toHaveBeenCalled();
  });

  it("returns a generic response for missing researcher emails", async () => {
    calls.signIn.mockResolvedValueOnce({ error: { status: 400 } });
    const result = await researcherStart(post({ email: "missing@example.test" }));
    expect(result.status).toBe(200);
    expect(calls.signIn).toHaveBeenCalledWith({
      email: "missing@example.test", options: {
        shouldCreateUser: false, emailRedirectTo: origin + "/api/researcher/auth/callback",
      },
    });
  });

  it("allows only provisioned researchers through the magic-link callback", async () => {
    const url = origin + "/api/researcher/auth/callback?token_hash=test-hash&type=email&next=https://untrusted.test";
    calls.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const rejected = await researcherCallback(new NextRequest(url));
    expect(rejected.headers.get("Location")).toBe(origin + "/app/sign-in?error=expired");
    expect(calls.commit).not.toHaveBeenCalled();
    const accepted = await researcherCallback(new NextRequest(url));
    expect(accepted.headers.get("Location")).toBe(origin + "/app/mfa");
    expect(calls.commit).toHaveBeenCalledOnce();
  });

  it("denies TOTP enrollment for an account without researcher membership", async () => {
    calls.getUser.mockResolvedValue({ data: { user: { id: userId, email_confirmed_at: "2026-11-20" } } });
    calls.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await researcherMfa(post({ action: "enroll" }))).status).toBe(403);
    expect(calls.enroll).not.toHaveBeenCalled();
  });

  it.each([
    [400, 401], [401, 401], [429, 429], [500, 503], [503, 503], [undefined, 503],
  ])("classifies an MFA identity lookup failure (provider %s, response %i)", async (status, expected) => {
    calls.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status } });
    const response = await researcherMfa(post({ action: "status" }));
    expect(response.status).toBe(expected);
    expect(await response.json()).toEqual({ ok: false });
    expect(calls.maybeSingle).not.toHaveBeenCalled();
    expect(calls.listFactors).not.toHaveBeenCalled();
    expect(calls.commit).not.toHaveBeenCalled();
  });
});
