import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverQueuedNudges, type NudgeTransport } from "@envoi-labs/services/nudge-delivery";
import type { Database } from "../../../../packages/db/src/database.generated";
import { createResumeLink } from "../respondent/resume-link";
import { createGate2NudgeDeliveryLedger } from "./gate2-nudge-delivery-db";

// No job or route calls this until push copy, provider and consent are approved.
export async function deliverGate2Nudges(client: SupabaseClient<Database>,
  transport: NudgeTransport, now: () => Date = () => new Date()) {
  if (process.env.ENVOI_GATE2_PUSH_DELIVERY_ENABLED !== "true")
    return { prepared: 0, sent: 0, failed: 0, unresolved: 0 };
  return deliverQueuedNudges({
    ledger: createGate2NudgeDeliveryLedger(client), transport,
    newClaimId: randomUUID,
    makeResumePath: (inviteId, respondentId, expiresAt) =>
      createResumeLink(inviteId, respondentId, expiresAt, now().getTime()),
    now,
  });
}
