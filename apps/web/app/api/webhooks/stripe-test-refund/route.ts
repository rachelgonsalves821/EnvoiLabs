import { reconcileCheckoutObservation } from "@envoi-labs/services/paid-study";
import type { NextRequest } from "next/server";
import { failure, reply } from "../../../../server/auth/http";
import { trustedClient } from "../../../../server/auth/supabase";
import { createGate2PaidStudyDatabase } from "../../../../server/platform/gate2-paid-study-db";
import { createGate2RefundDatabase, readGate2RefundWebhookClaim } from
  "../../../../server/platform/gate2-refund-db";
import { createStripeTestPaymentObserver } from
  "../../../../server/platform/gate2-stripe-payment-test";
import { createStripeTestRefundProvider } from
  "../../../../server/platform/gate2-stripe-refund-test";
import { verifyStripeTestRefundHint } from
  "../../../../server/platform/gate2-stripe-webhook";

export async function POST(request: NextRequest) {
  if (process.env.ENVOI_GATE2_TEST_WEBHOOK_ENABLED !== "true") return failure(404);
  const signingSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET;
  const secretKey = process.env.STRIPE_TEST_SECRET_KEY;
  if (!signingSecret?.startsWith("whsec_") || !secretKey?.startsWith("sk_test_"))
    return failure(503);
  let rawBody: Uint8Array;
  try { rawBody = new Uint8Array(await request.arrayBuffer()); }
  catch { return failure(400); }
  const hint = verifyStripeTestRefundHint({ rawBody,
    signature: request.headers.get("stripe-signature"), secret: signingSecret });
  if (!hint) return failure(400);
  const trusted = trustedClient();
  if (!trusted) return failure(503);
  try {
    const intent = await readGate2RefundWebhookClaim(trusted, hint.reservationId);
    if (!intent) return reply(200, { status: "ignored" });
    // The signed event supplies an ID only. Fetch the current provider object
    // and bind it to the immutable local amount, quote and PaymentIntent.
    const observation = await createStripeTestRefundProvider({ secretKey })
      .get(hint.refundId, intent);
    const recorded = await createGate2RefundDatabase(trusted)
      .record(intent.reservationId, observation);
    if (!recorded) return failure(503);
    if (observation.kind === "succeeded") {
      const state = await reconcileCheckoutObservation(
        createGate2PaidStudyDatabase(trusted),
        createStripeTestPaymentObserver({ secretKey }),
        intent.studyId, intent.quoteId);
      if (state === "unavailable") return failure(503);
    }
    return reply(200, { status: observation.kind });
  } catch { return failure(503); }
}
