import type { NextRequest } from "next/server";
import { failure, input, providerFailure, reply } from "./http";
import { phoneDataKey, protectPhone } from "./phone-data";
import { requestSession, trustedClient } from "./supabase";

const phonePattern = /^\+1[2-9]\d{2}[2-9]\d{6}$/;
const codePattern = /^\d{6}$/;

export async function respondentAuth(request: NextRequest, verify: boolean) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const { phone, ageAttested, code } = parsed.body;
  if (typeof phone !== "string" || !phonePattern.test(phone) || ageAttested !== true
      || (verify && (typeof code !== "string" || !codePattern.test(code)))) return failure(400);

  const session = requestSession(request);
  const service = trustedClient();
  const key = phoneDataKey();
  if (!session.client || !service || !key) return failure(503);
  if (!verify) {
    const { error } = await session.client.auth.signInWithOtp({ phone, options: { channel: "sms" } });
    return error ? providerFailure(error, 400) : reply();
  }

  if (typeof code !== "string") return failure(400);
  const { data, error } = await session.client.auth.verifyOtp({ phone, token: code, type: "sms" });
  if (error || !data.user || !data.session) return providerFailure(error, 401);
  const protectedPhone = protectPhone(phone, key);
  const { error: onboardingError } = await service.rpc("provision_respondent", {
    supplied_user_id: data.user.id,
    supplied_ciphertext: protectedPhone.ciphertext,
    supplied_hash: protectedPhone.hash,
  });
  if (onboardingError) {
    return failure(["23505", "42501"].includes(onboardingError.code) ? 403 : 503);
  }
  return session.commit(reply());
}
