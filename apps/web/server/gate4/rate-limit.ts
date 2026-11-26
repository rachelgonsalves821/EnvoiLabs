import { createHmac } from "node:crypto";
import { normalizeEmail } from "../auth/email-link";

export type RateLimitPolicy = {
  windowSeconds: number;
  emailStartsPerAddress: number;
  emailStartsPerSource: number;
  audioUploadsPerRespondent: number;
  audioUploadsPerSource: number;
};

export type RateLimitRule = {
  surface: "email-start" | "audio-upload";
  keyKind: "email" | "respondent" | "source";
  keyDigest: string;
  maxAttempts: number;
  windowSeconds: number;
};

export type AtomicRateLimitStore = {
  // One transaction must check and increment every rule together, using database time.
  consume(rules: readonly [RateLimitRule, RateLimitRule]): Promise<
    { allowed: true } | { allowed: false; retryAfterSeconds: number }
  >;
};

export type RateLimitDecision =
  | { kind: "allow" }
  | { kind: "limited"; retryAfterSeconds: number }
  | { kind: "invalid" }
  | { kind: "unavailable" };

type LimiterPorts = { store: AtomicRateLimitStore; hmacSecret: string; policy: RateLimitPolicy };
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

function validPolicy(policy: RateLimitPolicy) {
  return [policy.windowSeconds, policy.emailStartsPerAddress, policy.emailStartsPerSource,
    policy.audioUploadsPerRespondent, policy.audioUploadsPerSource]
    .every((value) => Number.isSafeInteger(value) && value > 0);
}

function digest(secret: string, kind: string, value: string) {
  return createHmac("sha256", secret).update(`gate4-rate-v1\0${kind}\0${value}`).digest("hex");
}

export function createGate4RateLimiter({ store, hmacSecret, policy }: LimiterPorts) {
  const configured = Buffer.byteLength(hmacSecret) >= 32 && validPolicy(policy);

  async function decide(surface: RateLimitRule["surface"], identityKind: "email" | "respondent",
    identity: string, trustedSource: string, identityMax: number, sourceMax: number): Promise<RateLimitDecision> {
    // The caller must supply a source derived from trusted ingress, never a raw client header.
    if (!configured || !trustedSource || trustedSource !== trustedSource.trim() || trustedSource.length > 128) {
      return { kind: "unavailable" };
    }
    const rules: [RateLimitRule, RateLimitRule] = [
      { surface, keyKind: identityKind, keyDigest: digest(hmacSecret, identityKind, identity),
        maxAttempts: identityMax, windowSeconds: policy.windowSeconds },
      { surface, keyKind: "source", keyDigest: digest(hmacSecret, `${surface}:source`, trustedSource),
        maxAttempts: sourceMax, windowSeconds: policy.windowSeconds },
    ];
    try {
      const result = await store.consume(rules);
      if (result.allowed === true) return { kind: "allow" };
      if (Number.isSafeInteger(result.retryAfterSeconds) && result.retryAfterSeconds > 0) {
        return { kind: "limited", retryAfterSeconds: result.retryAfterSeconds };
      }
      return { kind: "unavailable" };
    } catch {
      return { kind: "unavailable" };
    }
  }

  return {
    emailStart(email: unknown, trustedSource: string): Promise<RateLimitDecision> {
      const normalized = normalizeEmail(email);
      if (!normalized) return Promise.resolve({ kind: "invalid" });
      return decide("email-start", "email", normalized, trustedSource,
        policy.emailStartsPerAddress, policy.emailStartsPerSource);
    },
    audioUpload(respondentId: string, trustedSource: string): Promise<RateLimitDecision> {
      if (!uuid.test(respondentId)) return Promise.resolve({ kind: "invalid" });
      return decide("audio-upload", "respondent", respondentId.toLowerCase(), trustedSource,
        policy.audioUploadsPerRespondent, policy.audioUploadsPerSource);
    },
  };
}
