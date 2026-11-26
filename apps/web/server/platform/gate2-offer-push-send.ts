import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchMatchedOfferPush } from "@envoi-labs/services/offer-push";
import type { Database } from "../../../../packages/db/src/database.generated";
import { createGate2OfferPushLedger } from "./gate2-offer-push-db";
import type { Gate2WebPushTransport } from "./gate2-web-push";

// Both push delivery and matched-offer switches default off; no scheduler is installed.
export async function dispatchGate2MatchedOffers(client: SupabaseClient<Database>,
  transport: Gate2WebPushTransport, now: () => Date = () => new Date()) {
  if (process.env.ENVOI_GATE2_PUSH_DELIVERY_ENABLED !== "true" ||
      process.env.ENVOI_GATE2_OFFER_PUSH_ENABLED !== "true")
    return { queued: 0, sent: 0, failed: 0, unresolved: 0 };
  return dispatchMatchedOfferPush({
    ledger: createGate2OfferPushLedger(client),
    transport, newClaimId: randomUUID, now,
  });
}
