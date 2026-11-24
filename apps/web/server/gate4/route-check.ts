import type { NextRequest } from "next/server";
import { createGate4RateLimiter, type AtomicRateLimitStore, type RateLimitDecision } from "./rate-limit";
import { previewRateLimitConfig, previewTrustedSource } from "./preview-config";

export type Gate4RouteCheck = (request: NextRequest, surface: "email-start" | "audio-upload",
  identity: string) => Promise<RateLimitDecision>;

// No store is connected until the Gate 2 migration lands. Explicit preview opt-in without
// a valid store/config/source fails closed; production and existing local routes are unchanged.
export function createGate4RouteCheck(store?: AtomicRateLimitStore,
  env: Record<string, string | undefined> = process.env): Gate4RouteCheck {
  return async (request, surface, identity) => {
    if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview" ||
        env.GATE4_RATE_LIMIT_PREVIEW_ENABLED !== "1") return { kind: "allow" };
    const config = previewRateLimitConfig(env);
    const source = previewTrustedSource(request.headers, env);
    if (!config || !source || !store) return { kind: "unavailable" };
    const limiter = createGate4RateLimiter({ store, ...config });
    return surface === "email-start"
      ? limiter.emailStart(identity, source) : limiter.audioUpload(identity, source);
  };
}

export const gate4RouteCheck = createGate4RouteCheck();
