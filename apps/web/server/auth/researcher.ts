import { NextResponse, type NextRequest } from "next/server";
import { emailCallbackCredential, normalizeEmail } from "./email-link";
import { failure, input, providerFailure, reply } from "./http";
import { appOrigin, privateHeaders, requestSession, trustedClient } from "./supabase";

const codePattern = /^\d{6}$/;
const uuidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

async function researcherMembership(userId: string): Promise<"member" | "absent" | "unavailable"> {
  const service = trustedClient();
  if (!service) return "unavailable";
  const { data, error } = await service.from("researchers").select("id")
    .eq("auth_user_id", userId).maybeSingle();
  if (error) return "unavailable";
  return typeof data?.id === "string" ? "member" : "absent";
}

export async function researcherStart(request: NextRequest) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const email = normalizeEmail(parsed.body.email);
  if (!email) return failure(400);

  const origin = appOrigin();
  const session = requestSession(request, { keepPendingVerifier: true });
  const { client } = session;
  if (!origin || !client || !trustedClient()) return failure(503);
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/api/researcher/auth/callback` },
  });
  if (error?.status === 429) return failure(429);
  if (error && (!error.status || error.status >= 500)) return failure(503);
  // Preserve the browser's verifier for standard Supabase links, including on a generic reply.
  return session.commit(reply());
}

export async function researcherCallback(request: NextRequest) {
  const origin = appOrigin();
  if (!origin) return failure(503);
  const expired = () => NextResponse.redirect(`${origin}/app/sign-in?error=expired`, {
    status: 303, headers: privateHeaders,
  });
  const credential = emailCallbackCredential(request.nextUrl.searchParams);
  if (!credential) return expired();

  const session = requestSession(request);
  if (!session.client) return failure(503);
  const { data, error } = "code" in credential
    ? await session.client.auth.exchangeCodeForSession(credential.code)
    : await session.client.auth.verifyOtp({ token_hash: credential.token, type: "email" });
  if (error || !data.user?.email_confirmed_at || !data.session
      || (await researcherMembership(data.user.id)) !== "member") return expired();
  return session.commit(NextResponse.redirect(`${origin}/app/mfa`, {
    status: 303, headers: privateHeaders,
  }));
}

export async function researcherMfa(request: NextRequest) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const { action, factorId, challengeId, code } = parsed.body;
  if (!["status", "enroll", "challenge", "verify"].includes(String(action))) return failure(400);

  const session = requestSession(request);
  if (!session.client) return failure(503);
  const { auth } = session.client;
  const { data: user, error: userError } = await auth.getUser();
  if (userError) return providerFailure(userError, 401);
  if (!user.user?.email_confirmed_at) return failure(401);
  const membership = await researcherMembership(user.user.id);
  if (membership !== "member") return failure(membership === "unavailable" ? 503 : 403);
  const { data: factors, error: factorsError } = await auth.mfa.listFactors();
  if (factorsError) return providerFailure(factorsError, 401);
  const totp = factors.all.filter((factor) => factor.factor_type === "totp");
  const verifiedFactor = totp.find((factor) => factor.status === "verified");
  const commit = (data: object) => session.commit(reply(200, data));

  if (action === "status") {
    const { data: assurance, error } = await auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return providerFailure(error, 401);
    if (!verifiedFactor) return commit({ state: "enroll" });
    return commit(assurance.currentLevel === "aal2"
      ? { state: "verified" } : { state: "challenge", factorId: verifiedFactor.id });
  }

  if (action === "enroll") {
    if (verifiedFactor) return failure(409);
    // Each setup returns the secret once. Discard abandoned unverified enrollment.
    for (const factor of totp) {
      const { error } = await auth.mfa.unenroll({ factorId: factor.id });
      if (error) return providerFailure(error, 409);
    }
    const { data, error } = await auth.mfa.enroll({ factorType: "totp" });
    return error ? providerFailure(error, 409) : commit({ factorId: data.id, secret: data.totp.secret });
  }

  if (typeof factorId !== "string" || !uuidPattern.test(factorId)
      || !totp.some(({ id }) => id === factorId)) return failure(400);
  if (action === "challenge") {
    const { data, error } = await auth.mfa.challenge({ factorId });
    return error ? providerFailure(error, 401) : commit({ challengeId: data.id });
  }

  if (typeof challengeId !== "string" || !uuidPattern.test(challengeId)
      || typeof code !== "string" || !codePattern.test(code)) return failure(400);
  const { error } = await auth.mfa.verify({ factorId, challengeId, code });
  return error ? providerFailure(error, 401) : commit({ ok: true });
}
