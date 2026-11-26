import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { failure, reply } from "../../../../../server/auth/http";
import { trustedClient } from "../../../../../server/auth/supabase";
import { dispatchGate2MatchedOffers } from
  "../../../../../server/platform/gate2-offer-push-send";
import { createGate2WebPushTransport } from
  "../../../../../server/platform/gate2-web-push";

export const runtime = "nodejs";

function authorized(request: NextRequest, secret: string) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ") || header.length > 263) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length &&
    timingSafeEqual(supplied, expected);
}

/** No schedule or copy is configured. The offer-specific switch stays off. */
export async function POST(request: NextRequest) {
  if (process.env.ENVOI_GATE2_OFFER_PUSH_ENABLED !== "true" ||
    process.env.ENVOI_GATE2_PUSH_JOB_ENABLED !== "true" ||
    process.env.ENVOI_GATE2_PUSH_DELIVERY_ENABLED !== "true" ||
    process.env.ENVOI_GATE2_PUSH_WORKER_ENABLED !== "true" ||
    process.env.ENVOI_GATE2_PUSH_REGISTRATION_ENABLED !== "true")
    return failure(404);
  const secret = process.env.ENVOI_GATE2_PUSH_JOB_SECRET;
  if (!secret || secret.length < 32 || secret.length > 128)
    return failure(503);
  if (!authorized(request, secret)) return failure(403);
  const client = trustedClient();
  if (!client) return failure(503);
  const origins = process.env.ENVOI_GATE2_PUSH_ALLOWED_ORIGINS
    ?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  let transport;
  try {
    transport = createGate2WebPushTransport({
      vapidSubject: process.env.ENVOI_GATE2_VAPID_SUBJECT ?? "",
      vapidPublicKey: process.env.ENVOI_GATE2_VAPID_PUBLIC_KEY ?? "",
      vapidPrivateKey: process.env.ENVOI_GATE2_VAPID_PRIVATE_KEY ?? "",
      allowedPushOrigins: origins,
    });
  } catch { return failure(503); }
  try {
    const result = await dispatchGate2MatchedOffers(client, transport);
    if (result.unresolved) return failure(503);
    return reply(200, { queued: result.queued,
      sent: result.sent, failed: result.failed });
  } catch { return failure(503); }
}
