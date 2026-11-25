import type { SupabaseClient } from "@supabase/supabase-js";
import type { NudgeDeliveryLedger, ClaimedNudgeDelivery } from
  "@envoi-labs/services/nudge-delivery";
import type { Database } from "../../../../packages/db/src/database.generated";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string" && uuid.test(id)))
    throw new Error("Invalid private nudge delivery IDs");
  return value;
}

function claimed(value: unknown, deliveryId: string, claimId: string): ClaimedNudgeDelivery | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid private nudge claim");
  const row = value as Record<string, unknown>;
  const keys = row.keys as Record<string, unknown> | null;
  if (row.deliveryId !== deliveryId || row.claimId !== claimId ||
    typeof row.inviteId !== "string" || !uuid.test(row.inviteId) ||
    typeof row.respondentId !== "string" || !uuid.test(row.respondentId) ||
    typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt)) ||
    (row.kind !== "halfway" && row.kind !== "two_hours_left") ||
    typeof row.endpoint !== "string" || !row.endpoint.startsWith("https://") ||
    !keys || typeof keys.p256dh !== "string" || !keys.p256dh ||
    typeof keys.auth !== "string" || !keys.auth)
    throw new Error("Invalid private nudge claim");
  return row as ClaimedNudgeDelivery;
}

export function createGate2NudgeDeliveryLedger(
  client: SupabaseClient<Database>): NudgeDeliveryLedger {
  return {
    async listDispatchable() {
      const { data, error } = await client.rpc("list_gate2_nudge_dispatchable");
      if (error) throw error;
      return ids(data);
    },
    async prepare(outboxId) {
      const { data, error } = await client.rpc("prepare_gate2_nudge_deliveries", {
        supplied_outbox_id: outboxId,
      });
      if (error) throw error;
      return ids(data);
    },
    async claim(deliveryId, claimId) {
      const { data, error } = await client.rpc("claim_gate2_nudge_delivery", {
        supplied_delivery_id: deliveryId, supplied_claim_id: claimId,
      });
      if (error) throw error;
      return claimed(data, deliveryId, claimId);
    },
    async observe(deliveryId, claimId, state) {
      const { data, error } = await client.rpc("observe_gate2_nudge_delivery", {
        supplied_delivery_id: deliveryId, supplied_claim_id: claimId,
        supplied_state: state,
      });
      if (error) throw error;
      if (typeof data !== "boolean") throw new Error("Invalid nudge observation");
      return data;
    },
  };
}
