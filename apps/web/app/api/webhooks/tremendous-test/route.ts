import type { NextRequest } from "next/server";
import { failure, reply } from "../../../../server/auth/http";
import { trustedClient } from "../../../../server/auth/supabase";
import { createGate2SandboxBatchPayoutDatabase,
  readGate2SandboxPayoutRecipient, readGate2SandboxWebhookClaim } from
  "../../../../server/platform/gate2-sandbox-payout-db";
import { createTremendousSandboxPayoutProvider } from
  "../../../../server/platform/gate2-tremendous-sandbox";
import { verifyTremendousSandboxHint } from
  "../../../../server/platform/gate2-tremendous-webhook";
import { createTremendousSandboxOrderResolver,
  reconcileTremendousSandboxHint } from
  "../../../../server/platform/gate2-tremendous-webhook-process";
import { isolatedTremendousTestWebhookEnvironment } from
  "../../../../server/platform/gate2-tremendous-test-isolation";

export async function POST(request: NextRequest) {
  if (process.env.ENVOI_GATE2_TEST_WEBHOOK_ENABLED !== "true") return failure(404);
  if (process.env.VERCEL_ENV !== "preview") return failure(404);
  if (!isolatedTremendousTestWebhookEnvironment({
    VERCEL_ENV: process.env.VERCEL_ENV,
    SUPABASE_URL: process.env.SUPABASE_URL,
    ENVOI_GATE5_ISOLATED_DATABASE_URL: process.env.ENVOI_GATE5_ISOLATED_DATABASE_URL,
    ENVOI_GATE5_PRODUCTION_DATABASE_URL: process.env.ENVOI_GATE5_PRODUCTION_DATABASE_URL,
    ENVOI_GATE5_PREVIEW_PROJECT_REF: process.env.ENVOI_GATE5_PREVIEW_PROJECT_REF,
    ENVOI_GATE5_PRODUCTION_PROJECT_REF: process.env.ENVOI_GATE5_PRODUCTION_PROJECT_REF,
    ENVOI_GATE5_ISOLATION_APPROVED: process.env.ENVOI_GATE5_ISOLATION_APPROVED,
  })) return failure(503);
  const signingSecret = process.env.TREMENDOUS_TEST_WEBHOOK_SECRET;
  const apiKey = process.env.TREMENDOUS_TEST_API_KEY;
  if (!signingSecret || !apiKey?.startsWith("TEST_")) return failure(503);
  let rawBody: Uint8Array;
  try { rawBody = new Uint8Array(await request.arrayBuffer()); }
  catch { return failure(400); }
  const hint = verifyTremendousSandboxHint({ rawBody,
    signature: request.headers.get("tremendous-webhook-signature"),
    secret: signingSecret });
  if (!hint) return failure(400);
  const trusted = trustedClient();
  if (!trusted) return failure(503);
  const provider = createTremendousSandboxPayoutProvider({ apiKey,
    recipient: (payoutId) => readGate2SandboxPayoutRecipient(trusted, payoutId) });
  const result = await reconcileTremendousSandboxHint(hint, {
    resolveOrder: createTremendousSandboxOrderResolver({ apiKey }),
    readClaim: (payoutId) => readGate2SandboxWebhookClaim(trusted, payoutId),
    getOrderByKey: provider.getOrderByKey,
    recordOrder: createGate2SandboxBatchPayoutDatabase(trusted, 200_000).recordOrder,
  });
  return result === "unavailable" ? failure(503) : reply(200, { status: result });
}
