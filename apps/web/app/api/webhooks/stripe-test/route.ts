import { reconcileCheckoutObservation, reconcilePaidStudyLaunch } from
  "@envoi-labs/services/paid-study";
import type { NextRequest } from "next/server";
import { failure, reply } from "../../../../server/auth/http";
import { trustedClient } from "../../../../server/auth/supabase";
import { createGate2PaidStudyDatabase } from "../../../../server/platform/gate2-paid-study-db";
import { createStripeTestPaymentObserver } from
  "../../../../server/platform/gate2-stripe-payment-test";
import { verifyStripeTestCheckoutHint } from
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
  const hint = verifyStripeTestCheckoutHint({ rawBody,
    signature: request.headers.get("stripe-signature"), secret: signingSecret });
  if (!hint) return failure(400);
  const trusted = trustedClient();
  if (!trusted) return failure(503);
  const { data: checkout, error } = await trusted.from("gate2_payment_events")
    .select("quote_id,study_id").eq("provider_checkout_id", hint.checkoutId)
    .eq("event_kind", "checkout_created").maybeSingle();
  if (error) return failure(503);
  // A valid signed event from this Stripe account can belong to another
  // product. Only our stored Checkout identity may initiate reconciliation.
  if (!checkout) return reply(200, { status: "ignored" });
  const db = createGate2PaidStudyDatabase(trusted);
  const provider = createStripeTestPaymentObserver({ secretKey });
  const success = hint.type === "checkout.session.completed" ||
    hint.type === "checkout.session.async_payment_succeeded";
  const result = success
    ? await reconcilePaidStudyLaunch(db, provider, checkout.study_id, checkout.quote_id)
    : await reconcileCheckoutObservation(db, provider, checkout.study_id, checkout.quote_id);
  if (result === "unavailable") return failure(503);
  if (result === "launched") {
    const { data: wave, error: waveError } = await trusted.rpc(
      "create_gate2_paid_launch_wave", {
        supplied_study_id: checkout.study_id,
        supplied_quote_id: checkout.quote_id,
      });
    if (waveError || !wave || typeof wave !== "object" ||
      Array.isArray(wave) || !Number.isSafeInteger(wave.created) ||
      (wave.created as number) < 0) return failure(503);
    return reply(200, { status: "launched", offersCreated: wave.created });
  }
  if (result === "refund_reserved")
    return reply(200, { status: "refund_reserved" });
  return reply(200, { status: "observed" });
}
