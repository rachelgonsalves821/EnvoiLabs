import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedOfferPush, OfferPushLedger } from
  "@envoi-labs/services/offer-push";
import type { Database } from "../../../../packages/db/src/database.generated";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ids = (value: unknown, max = 500): string[] => {
  if (!Array.isArray(value) || value.length > max ||
      !value.every((id) => typeof id === "string" && uuid.test(id)))
    throw new Error("Invalid private offer push IDs");
  return value;
};
const claim = (value: unknown, deliveryId: string,
  claimId: string): ClaimedOfferPush | null => {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid private offer push claim");
  const row = value as Record<string, unknown>;
  const keys = row.keys as Record<string, unknown> | null;
  if (row.deliveryId !== deliveryId || row.claimId !== claimId ||
      typeof row.inviteId !== "string" || !uuid.test(row.inviteId) ||
      typeof row.respondentId !== "string" || !uuid.test(row.respondentId) ||
      typeof row.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(row.expiresAt)) ||
      typeof row.endpoint !== "string" || !row.endpoint.startsWith("https://") ||
      !keys || typeof keys.p256dh !== "string" || !keys.p256dh ||
      typeof keys.auth !== "string" || !keys.auth)
    throw new Error("Invalid private offer push claim");
  return row as ClaimedOfferPush;
};

export function createGate2OfferPushLedger(client: SupabaseClient<Database>):
OfferPushLedger {
  return {
    async readCandidates() {
      const { data, error } = await client.rpc("list_gate2_offer_push_candidates");
      if (error) throw error;
      return ids(data);
    },
    async enqueue(inviteId) {
      if (!uuid.test(inviteId)) throw new Error("Invalid offer identity");
      const { data, error } = await client.rpc("queue_gate2_offer_push", {
        supplied_invite_id: inviteId });
      if (error) throw error;
      if (typeof data !== "boolean") throw new Error("Invalid offer queue result");
      return data;
    },
    async listDispatchable() {
      const { data, error } = await client.rpc("list_gate2_offer_push_dispatchable");
      if (error) throw error;
      // The ledger's dispatchable query is not paged yet.
      return ids(data, Number.MAX_SAFE_INTEGER);
    },
    async prepare(outboxId) {
      if (!uuid.test(outboxId)) throw new Error("Invalid offer outbox identity");
      const { data, error } = await client.rpc("prepare_gate2_offer_push_deliveries", {
        supplied_outbox_id: outboxId });
      if (error) throw error;
      return ids(data);
    },
    async claim(deliveryId, claimId) {
      if (!uuid.test(deliveryId) || !uuid.test(claimId))
        throw new Error("Invalid offer claim identity");
      const { data, error } = await client.rpc("claim_gate2_offer_push_delivery", {
        supplied_delivery_id: deliveryId, supplied_claim_id: claimId });
      if (error) throw error;
      return claim(data, deliveryId, claimId);
    },
    async observe(deliveryId, claimId, state) {
      const { data, error } = await client.rpc("observe_gate2_offer_push_delivery", {
        supplied_delivery_id: deliveryId, supplied_claim_id: claimId,
        supplied_state: state });
      if (error) throw error;
      if (typeof data !== "boolean") throw new Error("Invalid offer observation");
      return data;
    },
  };
}
