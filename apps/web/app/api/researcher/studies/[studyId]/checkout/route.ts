import { prepareStudyCheckout } from "@envoi-labs/services/checkout";
import type { NextRequest } from "next/server";
import { failure, input, reply } from "../../../../../../server/auth/http";
import { appOrigin, requestSession, trustedClient } from "../../../../../../server/auth/supabase";
import { createGate2CheckoutDatabase } from "../../../../../../server/platform/gate2-checkout-db";
import { createStripeTestCheckoutProvider } from "../../../../../../server/platform/gate2-stripe-test";

export async function POST(request: NextRequest,
  { params }: { params: Promise<{ studyId: string }> }) {
  if (process.env.ENVOI_GATE2_TEST_CHECKOUT_ENABLED !== "true") return failure(404);
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  if (Object.keys(parsed.body).length !== 0) return failure(400);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const identity = await session.client.auth.getClaims();
  const authUserId = identity.data?.claims?.sub;
  if (identity.error || identity.data?.claims?.aal !== "aal2" || !authUserId)
    return session.commit(failure(403));
  const { studyId } = await params;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(studyId))
    return session.commit(failure(404));
  const { data: researcher, error } = await session.client.from("researchers")
    .select("id,organization_id").eq("auth_user_id", authUserId).maybeSingle();
  if (error) return session.commit(failure(503));
  if (!researcher) return session.commit(failure(403));
  const trusted = trustedClient();
  const origin = appOrigin();
  const secretKey = process.env.STRIPE_TEST_SECRET_KEY;
  if (!trusted || !origin?.startsWith("https://") || !secretKey?.startsWith("sk_test_"))
    return session.commit(failure(503));
  try {
    const returnPath = `${origin}/app/studies/${encodeURIComponent(studyId)}`;
    const provider = createStripeTestCheckoutProvider({ secretKey,
      successUrl: `${returnPath}?checkout=returned`,
      cancelUrl: `${returnPath}?checkout=cancelled` });
    const db = createGate2CheckoutDatabase(trusted, {
      id: researcher.id, organizationId: researcher.organization_id, authUserId });
    const result = await prepareStudyCheckout(db, provider, studyId);
    return session.commit(result.status === "ready"
      ? reply(200, { quoteId: result.quote.id, totalCents: result.quote.totalCents,
        currency: result.quote.currency, feasibility: result.quote.feasibility,
        checkoutUrl: result.checkout.url })
      : failure(result.status === "blocked" ? 409 : 503));
  } catch {
    return session.commit(failure(503));
  }
}
