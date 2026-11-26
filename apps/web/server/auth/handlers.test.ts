import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { researcherCallback, researcherMfa, researcherStart } from "./researcher";
import { respondentCallback, respondentStart } from "./respondent";

const calls = vi.hoisted(() => ({
  commit: vi.fn(), signIn: vi.fn(), verifyOtp: vi.fn(), exchangeCode: vi.fn(), enroll: vi.fn(),
  rpc: vi.fn(), maybeSingle: vi.fn(), getUser: vi.fn(), listFactors: vi.fn(),
}));
const origin = "https://example.test";
const userId = "00000000-0000-4000-8000-000000000001";
const email = "respondent@example.test";
const respondentCallbackPath = "/api/respondent/auth/callback";
const authCode = "f7370adf-aad5-47fd-bfab-ad372e4591e6";

vi.mock("./supabase", () => ({
  appOrigin: () => "https://example.test",
  privateHeaders: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  requestSession: () => ({
    client: { auth: {
      signInWithOtp: calls.signIn, verifyOtp: calls.verifyOtp, exchangeCodeForSession: calls.exchangeCode, getUser: calls.getUser,
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
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-key-for-test-only");
    calls.commit.mockImplementation((response: Response) => response);
    calls.signIn.mockResolvedValue({ error: null });
    calls.verifyOtp.mockResolvedValue({
      data: { user: { id: userId, email, email_confirmed_at: "2026-11-20" }, session: {} }, error: null,
    });
    calls.exchangeCode.mockImplementation(calls.verifyOtp);
    calls.rpc.mockResolvedValue({ error: null });
    calls.maybeSingle.mockResolvedValue({ data: { id: userId }, error: null });
  });

  it("rejects cross-origin starts and missing attestation without sending a message", async () => {
    expect((await respondentStart(post({ email, ageAttested: true }, "https://untrusted.test"))).status).toBe(403);
    expect((await respondentStart(post({ email, ageAttested: false }))).status).toBe(400);
    expect(calls.signIn).not.toHaveBeenCalled();
  });

  it("rejects both email start paths before OTP when the shared limiter denies or is unavailable", async () => {
    const limited = vi.fn(async () => ({ kind: "limited" as const, retryAfterSeconds: 17 }));
    const unavailable = vi.fn(async () => ({ kind: "unavailable" as const }));
    const respondent = await respondentStart(post({ email, ageAttested: true }), limited);
    const researcher = await researcherStart(post({ email }), unavailable);
    expect(respondent.status).toBe(429);
    expect(respondent.headers.get("Retry-After")).toBe("17");
    expect(researcher.status).toBe(503);
    expect(limited).toHaveBeenCalledWith(expect.any(NextRequest), "email-start", email);
    expect(unavailable).toHaveBeenCalledWith(expect.any(NextRequest), "email-start", email);
    expect(calls.signIn).not.toHaveBeenCalled();
    expect(calls.commit).not.toHaveBeenCalled();
    expect(respondent.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("requests a sign-in link and provisions only after same-browser email verification", async () => {
    const started = await respondentStart(post({ email: " Respondent@Example.Test ", ageAttested: true }));
    expect(started.status).toBe(200);
    expect(calls.signIn).toHaveBeenCalledWith({
      email, options: { shouldCreateUser: true, emailRedirectTo: origin + respondentCallbackPath },
    });
    const cookie = started.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).not.toContain(email);
    expect(calls.rpc).not.toHaveBeenCalled();

    const request = new NextRequest(origin + respondentCallbackPath + "?code=" + authCode, {
      headers: { Cookie: cookie.split(";")[0]! },
    });
    const verified = await respondentCallback(request);
    expect(verified.headers.get("Location")).toBe(origin + "/r/status");
    expect(verified.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect(calls.rpc).toHaveBeenCalledWith("provision_email_respondent", { supplied_user_id: userId });
  });

  it("rejects a callback without an age proof and rejects one bound to another email", async () => {
    const url = origin + respondentCallbackPath + "?code=" + authCode;
    const missing = await respondentCallback(new NextRequest(url));
    expect(missing.headers.get("Location")).toBe(origin + "/r/signup?error=expired");
    expect(calls.exchangeCode).not.toHaveBeenCalled();
    const started = await respondentStart(post({ email: "other@example.test", ageAttested: true }));
    const cookie = started.headers.get("set-cookie")!.split(";")[0]!;
    calls.commit.mockClear();
    const mismatched = await respondentCallback(new NextRequest(url, { headers: { Cookie: cookie } }));
    expect(mismatched.headers.get("Location")).toBe(origin + "/r/signup?error=expired");
    expect(calls.rpc).not.toHaveBeenCalled();
    expect(calls.commit).not.toHaveBeenCalled();
  });

  it("does not commit a session when the respondent database rejects provisioning", async () => {
    const started = await respondentStart(post({ email, ageAttested: true }));
    const cookie = started.headers.get("set-cookie")!.split(";")[0]!;
    calls.commit.mockClear();
    calls.rpc.mockResolvedValueOnce({ error: { code: "42501" } });
    const result = await respondentCallback(new NextRequest(
      origin + respondentCallbackPath + "?token_hash=synthetic&type=email", { headers: { Cookie: cookie } },
    ));
    expect(result.headers.get("Location")).toBe(origin + "/r/signup?error=expired");
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

  it("exchanges a browser-bound provider callback and still requires researcher membership", async () => {
    const code = "f7370adf-aad5-47fd-bfab-ad372e4591e6";
    const request = new NextRequest(origin + "/api/researcher/auth/callback?code=" + code);
    const data = { user: { id: userId, email_confirmed_at: "2026-11-21" }, session: {} };
    calls.exchangeCode.mockResolvedValueOnce({ data: null, error: { status: 400 } });
    calls.exchangeCode.mockResolvedValue({ data, error: null });
    const wrongBrowser = await researcherCallback(request);
    expect(wrongBrowser.headers.get("Location")).toBe(origin + "/app/sign-in?error=expired");
    expect(calls.commit).not.toHaveBeenCalled();
    calls.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const nonmember = await researcherCallback(request);
    expect(nonmember.headers.get("Location")).toBe(origin + "/app/sign-in?error=expired");
    expect(calls.commit).not.toHaveBeenCalled();
    const member = await researcherCallback(request);
    expect(member.headers.get("Location")).toBe(origin + "/app/mfa");
    expect(calls.exchangeCode).toHaveBeenCalledWith(code);
    expect(calls.verifyOtp).not.toHaveBeenCalled();
    expect(calls.commit).toHaveBeenCalledOnce();
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

  it("allows enrollment to retry after the membership database recovers", async () => {
    calls.getUser.mockResolvedValue({ data: { user: { id: userId, email_confirmed_at: "2026-11-20" } } });
    calls.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "database unavailable" } });
    const failed = await researcherMfa(post({ action: "enroll" }));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ ok: false });
    expect(calls.listFactors).not.toHaveBeenCalled();
    expect(calls.enroll).not.toHaveBeenCalled();
    expect(calls.commit).not.toHaveBeenCalled();

    calls.listFactors.mockResolvedValueOnce({ data: { all: [] }, error: null });
    calls.enroll.mockResolvedValueOnce({ data: { id: userId, totp: { secret: "fixture" } }, error: null });
    const recovered = await researcherMfa(post({ action: "enroll" }));
    expect(recovered.status).toBe(200);
    expect(calls.enroll).toHaveBeenCalledOnce();
    expect(calls.commit).toHaveBeenCalledOnce();
  });

  it("requires a fresh sign-in link if membership cannot be checked after email verification", async () => {
    calls.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "database unavailable" } });
    const callback = new NextRequest(origin + "/api/researcher/auth/callback?token_hash=test-hash&type=email");
    const result = await researcherCallback(callback);
    expect(result.headers.get("Location")).toBe(origin + "/app/sign-in?error=expired");
    expect(calls.commit).not.toHaveBeenCalled();
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
