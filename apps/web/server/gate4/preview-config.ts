import { isIP } from "node:net";
import type { RateLimitPolicy } from "./rate-limit";

type PreviewEnvironment = Record<string, string | undefined>;

/** Preview-only boundary. The deployment must separately prove Vercel owns this header. */
export function previewTrustedSource(headers: Headers, env: PreviewEnvironment): string | null {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview") return null;
  const value = headers.get("x-vercel-forwarded-for");
  if (!value || value.includes(",") || value.includes("%") || !isIP(value)) return null;
  return value;
}

const policyVariables = {
  windowSeconds: "GATE4_RATE_LIMIT_WINDOW_SECONDS",
  emailStartsPerAddress: "GATE4_RATE_LIMIT_EMAIL_PER_ADDRESS",
  emailStartsPerSource: "GATE4_RATE_LIMIT_EMAIL_PER_SOURCE",
  audioUploadsPerRespondent: "GATE4_RATE_LIMIT_AUDIO_PER_RESPONDENT",
  audioUploadsPerSource: "GATE4_RATE_LIMIT_AUDIO_PER_SOURCE",
} as const;

export function previewRateLimitConfig(env: PreviewEnvironment):
  { hmacSecret: string; policy: RateLimitPolicy } | null {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview") return null;
  const hmacSecret = env.GATE4_RATE_LIMIT_HMAC_KEY;
  if (!hmacSecret || Buffer.byteLength(hmacSecret) < 32) return null;
  const values = Object.fromEntries(Object.entries(policyVariables).map(([key, variable]) =>
    [key, Number(env[variable])])) as RateLimitPolicy;
  if (!Object.values(values).every((value) => Number.isSafeInteger(value) && value > 0)) return null;
  return { hmacSecret, policy: values };
}
