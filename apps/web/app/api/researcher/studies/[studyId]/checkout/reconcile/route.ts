import { reconcileCheckoutObservation } from "@envoi-labs/services/paid-study";
import type { NextRequest } from "next/server";
import { failure, input, reply } from "../../../../../../../server/auth/http";
import { requestSession, trustedClient } from "../../../../../../../server/auth/supabase";
import { createGate2PaidStudyDatabase } from "../../../../../../../server/platform/gate2-paid-study-db";
import { takeGate2TestProviderBudget } from "../../../../../../../server/platform/gate2-provider-budget";
import { createStripeTestPaymentObserver } from "../../../../../../../server/platform/gate2-stripe-payment-test";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export async function POST(request: NextRequest,
  { params }: { params: Promise<{ studyId: string }> }) {
  if (process.env.ENVOI_GATE2_TEST_CHECKOUT_ENABLED !== "true") return failure(404);
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const { quoteId } = parsed.body;
  if (Object.keys(parsed.body).length !== 1 || typeof quoteId !== "string" || !uuid.test(quoteId))
    return failure(400);
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
  const secretKey = process.env.STRIPE_TEST_SECRET_KEY;
  if (!trusted || !secretKey?.startsWith("sk_test_")) return session.commit(failure(503));
  try {
    const budget = await takeGate2TestProviderBudget(trusted, studyId, authUserId);
    if (budget.status === "blocked") return session.commit(failure(404));
    if (budget.status === "unavailable") return session.commit(failure(503));
    if (budget.status === "limited") {
      const denied = failure(429);
      denied.headers.set("Retry-After", String(budget.retryAfterSeconds));
      return session.commit(denied);
    }
    const result = await reconcileCheckoutObservation(createGate2PaidStudyDatabase(trusted),
      createStripeTestPaymentObserver({ secretKey }), studyId, quoteId);
    return session.commit(result === "blocked" ? failure(409)
      : result === "unavailable" ? failure(503)
        : reply(200, { quoteId, paymentStatus: result }));
  } catch { return session.commit(failure(503)); }
}
