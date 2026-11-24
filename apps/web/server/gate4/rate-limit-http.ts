import { NextResponse } from "next/server";
import { privateHeaders } from "../auth/supabase";
import type { RateLimitDecision } from "./rate-limit";

// A route can call this only after its existing input/auth checks. No handler is wired yet.
export function rateLimitRejection(decision: RateLimitDecision): NextResponse | null {
  if (decision.kind === "allow") return null;
  const status = decision.kind === "invalid" ? 400 : decision.kind === "limited" ? 429 : 503;
  const retry = decision.kind === "limited"
    ? Math.min(decision.retryAfterSeconds, 3600) : decision.kind === "unavailable" ? 5 : null;
  return NextResponse.json({ ok: false }, { status, headers: {
    ...privateHeaders, ...(retry === null ? {} : { "Retry-After": String(retry) }),
  } });
}
