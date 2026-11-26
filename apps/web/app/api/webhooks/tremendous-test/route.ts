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

export async function POST(request: NextRequest) {
  if (process.env.ENVOI_GATE2_TEST_WEBHOOK_ENABLED !== "true") return failure(404);
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
