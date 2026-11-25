import { reserveUnfilledSlotRefund } from "@envoi-labs/services/refunds";
import { settleReservedRefund } from "@envoi-labs/services/refund-settlement";
import type { NextRequest } from "next/server";
import { failure, input, reply } from "../../../../../../server/auth/http";
import { appOrigin, requestSession, trustedClient } from "../../../../../../server/auth/supabase";
import { createGate2RefundDatabase } from "../../../../../../server/platform/gate2-refund-db";
import { createStripeTestRefundProvider } from "../../../../../../server/platform/gate2-stripe-refund-test";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function POST(request: NextRequest,
  { params }: { params: Promise<{ studyId: string }> }) {
  if (process.env.ENVOI_GATE2_TEST_REFUND_ENABLED !== "true") return failure(404);
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const { quoteId } = parsed.body;
  if (Object.keys(parsed.body).length !== 1 || typeof quoteId !== "string" ||
    !uuid.test(quoteId)) return failure(400);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const identity = await session.client.auth.getClaims();
  const authUserId = identity.data?.claims?.sub;
  if (identity.error || identity.data?.claims?.aal !== "aal2" || !authUserId)
    return session.commit(failure(403));
  const { studyId } = await params;
  if (!uuid.test(studyId)) return session.commit(failure(404));
  const { data: researcher, error } = await session.client.from("researchers")
    .select("id,organization_id").eq("auth_user_id", authUserId).maybeSingle();
  if (error) return session.commit(failure(503));
  if (!researcher) return session.commit(failure(403));
  const { data: study, error: studyError } = await session.client.from("studies")
    .select("id").eq("id", studyId)
    .eq("organization_id", researcher.organization_id).maybeSingle();
  if (studyError) return session.commit(failure(503));
  if (!study) return session.commit(failure(404));
  const trusted = trustedClient();
  const origin = appOrigin();
  const secretKey = process.env.STRIPE_TEST_SECRET_KEY;
  if (!trusted || !origin?.startsWith("https://") ||
    !secretKey?.startsWith("sk_test_"))
    return session.commit(failure(503));
  try {
    const reserved = await reserveUnfilledSlotRefund(
      (name, args) => trusted.rpc(name, args), studyId, quoteId, authUserId);
    if (reserved.status === "blocked") return session.commit(failure(409));
    if (reserved.status === "unavailable") return session.commit(failure(503));
    if (reserved.status === "fully_filled")
      return session.commit(reply(200, { quoteId, refundStatus: "fully_filled" }));
    const result = await settleReservedRefund({ reservationId: reserved.reservationId,
      authUserId, database: createGate2RefundDatabase(trusted),
      provider: createStripeTestRefundProvider({ secretKey }) });
    return session.commit(result.status === "blocked" ? failure(409)
      : result.status === "unavailable" ? failure(503)
        : reply(200, { quoteId, refundStatus: result.status,
          amountCents: result.amountCents, refundId: result.refundId }));
  } catch { return session.commit(failure(503)); }
}
