import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { emailCallbackCredential, normalizeEmail } from "./email-link";
import { failure, input, reply } from "./http";
import { appOrigin, privateHeaders, requestSession, trustedClient } from "./supabase";
import { gate4RouteCheck, type Gate4RouteCheck } from "../gate4/route-check";
import { rateLimitRejection } from "../gate4/rate-limit-http";

const callbackPath = "/api/respondent/auth/callback";
const ageProofCookie = "envoi-respondent-age";
const ageProofSeconds = 3600;

function proofDigest(key: string, email: string, expires: number) {
  return createHmac("sha256", key).update(`respondent-age-v1\0${email}\0${expires}`).digest();
}

function ageProofMatches(value: string, key: string, email: string) {
  const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(value);
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires <= Date.now()) return false;
  return timingSafeEqual(Buffer.from(match[2]!, "hex"), proofDigest(key, email, expires));
}

function cookieOptions(origin: string) {
  return {
    httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax" as const, path: callbackPath,
  };
}

export async function respondentStart(request: NextRequest, check: Gate4RouteCheck = gate4RouteCheck) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const email = normalizeEmail(parsed.body.email);
  if (!email || parsed.body.ageAttested !== true) return failure(400);

  const origin = appOrigin();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const session = requestSession(request, { keepPendingVerifier: true });
  if (!origin || !key || !session.client) return failure(503);
  const rejection = rateLimitRejection(await check(request, "email-start", email));
  if (rejection) return rejection;
  const { error } = await session.client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: origin + callbackPath },
  });
  if (error?.status === 429) return failure(429);
  if (error && (!error.status || error.status >= 500)) return failure(503);

  // Store a short-lived attestation bound to the requested address without logging or storing that address here.
  const expires = Date.now() + ageProofSeconds * 1000;
  const response = reply();
  response.cookies.set(ageProofCookie, `${expires}.${proofDigest(key, email, expires).toString("hex")}`, {
    ...cookieOptions(origin), maxAge: ageProofSeconds,
  });
  return session.commit(response);
}

export async function respondentCallback(request: NextRequest) {
  const origin = appOrigin();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) return failure(503);

  const redirect = (path: string) => NextResponse.redirect(origin + path, { status: 303, headers: privateHeaders });
  const expired = () => redirect("/r/signup?error=expired");
  const proof = request.cookies.get(ageProofCookie)?.value;
  const credential = emailCallbackCredential(request.nextUrl.searchParams);
  if (!proof || !credential) return expired();

  const service = trustedClient();
  const session = requestSession(request);
  if (!service || !session.client) return failure(503);
  const { data, error } = "code" in credential
    ? await session.client.auth.exchangeCodeForSession(credential.code)
    : await session.client.auth.verifyOtp({ token_hash: credential.token, type: "email" });
  const email = normalizeEmail(data?.user?.email);
  if (error || !data?.user?.email_confirmed_at || !data.session || !email || !ageProofMatches(proof, key, email)) {
    return expired();
  }
  const { error: provisioningError } = await service.rpc("provision_email_respondent", {
    supplied_user_id: data.user.id,
  });
  if (provisioningError) return expired();
  const response = redirect("/r/status");
  response.cookies.set(ageProofCookie, "", { ...cookieOptions(origin), maxAge: 0 });
  return session.commit(response);
}
