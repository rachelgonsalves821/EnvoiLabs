import type { NextRequest } from "next/server";
import { createGate4RateLimiter, type AtomicRateLimitStore, type RateLimitDecision } from "./rate-limit";
import { previewRateLimitConfig, previewTrustedSource } from "./preview-config";
import { trustedClient } from "../auth/supabase";
import { postgresAtomicRateStore, type RateLimitRpc } from "./rate-limit-store";

export type Gate4RouteCheck = (request: NextRequest, surface: "email-start" | "audio-upload",
  identity: string) => Promise<RateLimitDecision>;

function runtimeStore(): AtomicRateLimitStore | null {
  const client = trustedClient();
  return client ? postgresAtomicRateStore(client as unknown as RateLimitRpc) : null;
}

// The store is resolved only under explicit preview opt-in. Missing migration, policy,
// config, or trusted source fails closed; production and existing local routes are unchanged.
export function createGate4RouteCheck(store?: AtomicRateLimitStore,
  env: Record<string, string | undefined> = process.env,
  resolveStore: () => AtomicRateLimitStore | null = runtimeStore): Gate4RouteCheck {
  return async (request, surface, identity) => {
    if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview" ||
        env.GATE4_RATE_LIMIT_PREVIEW_ENABLED !== "1") return { kind: "allow" };
    const config = previewRateLimitConfig(env);
    const source = previewTrustedSource(request.headers, env);
    if (!config || !source) return { kind: "unavailable" };
    const activeStore = store ?? resolveStore();
    if (!activeStore) return { kind: "unavailable" };
    const limiter = createGate4RateLimiter({ store: activeStore, ...config });
    return surface === "email-start"
      ? limiter.emailStart(identity, source) : limiter.audioUpload(identity, source);
  };
}

export const gate4RouteCheck = createGate4RouteCheck();
