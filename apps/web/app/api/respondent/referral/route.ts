import type { NextRequest } from "next/server";
import { failure, input, reply } from "../../../../server/auth/http";
import { requestSession } from "../../../../server/auth/supabase";

const codeShape = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type Self = { code: string; attributed: boolean; profileVerified: boolean };
function parseSelf(value: unknown): Self | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.code === "string" && codeShape.test(record.code) &&
    typeof record.attributed === "boolean" && typeof record.profileVerified === "boolean"
    ? { code: record.code, attributed: record.attributed,
      profileVerified: record.profileVerified } : null;
}
async function current(request: NextRequest) {
  const session = requestSession(request);
  if (!session.client) return { session, error: 503 } as const;
  const identity = await session.client.auth.getClaims();
  if (identity.error || !identity.data?.claims?.sub) return { session, error: 403 } as const;
  return { session, error: null } as const;
}
export async function GET(request: NextRequest) {
  if (process.env.ENVOI_GATE2_REFERRAL_ENABLED !== "true") return failure(404);
  const { session, error } = await current(request);
  if (error) return session.commit(failure(error));
  const read = await session.client!.rpc("read_gate2_referral_self");
  if (read.error) return session.commit(failure(503));
  const value = parseSelf(read.data);
  return session.commit(value ? reply(200, value) : failure(404));
}
export async function POST(request: NextRequest) {
  if (process.env.ENVOI_GATE2_REFERRAL_ENABLED !== "true") return failure(404);
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const { code } = parsed.body;
  if (Object.keys(parsed.body).length !== 1 || typeof code !== "string" ||
    !codeShape.test(code)) return failure(400);
  const { session, error } = await current(request);
  if (error) return session.commit(failure(error));
  const registered = await session.client!.rpc("register_gate2_referral", {
    supplied_referral_code: code,
  });
  if (registered.error) return session.commit(failure(
    registered.error.code === "23514" ? 409 : 503));
  if (typeof registered.data !== "string") return session.commit(failure(503));
  const verified = await session.client!.rpc("verify_gate2_referred_profile");
  if (verified.error && verified.error.code !== "23514")
    return session.commit(failure(503));
  const read = await session.client!.rpc("read_gate2_referral_self");
  if (read.error) return session.commit(failure(503));
  const value = parseSelf(read.data);
  return session.commit(value?.attributed ? reply(200, value) : failure(503));
}
