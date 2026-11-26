import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { failure, reply } from "../../../../../server/auth/http";
import { trustedClient } from "../../../../../server/auth/supabase";
import { issueGate2SandboxVisaBatch } from "../../../../../server/platform/gate2-visa-batch-issue";

export const runtime = "nodejs";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function authorized(request: NextRequest, secret: string) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ") || header.length > 263) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/** Deliberate one-batch TEST invocation in the isolated fictional preview only. */
export async function POST(request: NextRequest) {
  if (process.env.ENVOI_GATE5_VISA_TEST_ENABLED !== "true") return failure(404);
  if (process.env.VERCEL_ENV !== "preview") return failure(404);
  const secret = process.env.ENVOI_GATE5_VISA_TEST_SECRET;
  const apiKey = process.env.TREMENDOUS_TEST_API_KEY;
  const databaseUrl = process.env.SUPABASE_URL;
  if (!secret || secret.length < 32 || secret.length > 128 ||
    !apiKey?.startsWith("TEST_") ||
    !databaseUrl || databaseUrl !== process.env.ENVOI_GATE5_ISOLATED_DATABASE_URL)
    return failure(503);
  if (!authorized(request, secret)) return failure(403);
  let body: unknown;
  try { body = await request.json(); } catch { return failure(400); }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "requestId,respondentId") return failure(400);
  const { respondentId, requestId } = body as Record<string, unknown>;
  if (typeof respondentId !== "string" || !uuid.test(respondentId) ||
    typeof requestId !== "string" || !uuid.test(requestId)) return failure(400);
  const client = trustedClient();
  if (!client) return failure(503);
  try {
    const status = await issueGate2SandboxVisaBatch({
      client, apiKey, respondentId, requestId, annualCapCents: 200000,
    });
    return reply(200, { status, mode: "tremendous_test_sandbox" });
  } catch { return failure(503); }
}
