import type { SupabaseClient } from "@supabase/supabase-js";
import { PayoutReservationDenied,
  type PayoutDatabase, type Reservation } from "@envoi-labs/services/payout";
import type { Database } from "../../../../packages/db/src/database.generated";

const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function reservation(value: unknown, sessionId: string): Reservation | null {
  if (!object(value) || !uuid(value.id) || value.sessionId !== sessionId ||
    !uuid(value.respondentId) || value.recipientId !== value.id ||
    typeof value.productId !== "string" || !value.productId ||
    !Number.isSafeInteger(value.amountCents) || (value.amountCents as number) <= 0 ||
    !["pending", "ordered", "delivered", "failed"].includes(String(value.state)) ||
    !(value.providerOrderId === null || typeof value.providerOrderId === "string"))
    return null;
  return value as Reservation;
}

// This database port is for TEST_-key testflight use only. Its RPC freezes a
// synthetic route and SKU with the respondent-locked payout reservation.
export function createGate2SandboxPayoutDatabase(client: SupabaseClient<Database>,
  annualCapCents: number): PayoutDatabase {
  if (!Number.isSafeInteger(annualCapCents) || annualCapCents <= 0 ||
    annualCapCents > 200000) throw new Error("Invalid payout cap");
  return {
    async reserveSessionPayout(sessionId, reservationKey) {
      if (!uuid(sessionId) || reservationKey !== `payout:${sessionId}`)
        throw new PayoutReservationDenied();
      const { data, error } = await client.rpc("reserve_gate2_sandbox_visa_intent", {
        requested_session_id: sessionId, annual_cap_cents: annualCapCents });
      if (error) {
        if (["23514", "23505", "42501"].includes(error.code))
          throw new PayoutReservationDenied();
        throw error;
      }
      const saved = reservation(data, sessionId);
      if (!saved) throw new Error("Invalid frozen sandbox payout intent");
      return saved;
    },
    async recordOrder(payoutId, observation) {
      if (!uuid(payoutId) || observation.recipientId !== payoutId ||
        !Number.isSafeInteger(observation.amountCents) ||
        !Number.isFinite(Date.parse(observation.observedAt)))
        throw new Error("Invalid sandbox payout observation");
      const { data, error } = await client.rpc("record_gate2_sandbox_visa_observation", {
        requested_payout_id: payoutId, requested_recipient_id: payoutId,
        requested_product_id: observation.productId,
        requested_event_id: observation.eventId,
        requested_order_id: observation.id,
        requested_kind: observation.status,
        requested_amount_cents: observation.amountCents,
        requested_observed_at: observation.observedAt });
      if (error) throw error;
      if (data !== true) throw new Error("Sandbox payout observation rejected");
    },
  };
}

export async function readGate2SandboxPayoutRecipient(
  client: SupabaseClient<Database>, payoutId: string) {
  if (!uuid(payoutId)) return null;
  const { data, error } = await client.rpc("read_gate2_sandbox_visa_recipient", {
    requested_payout_id: payoutId });
  if (error) throw error;
  if (!object(data) || typeof data.name !== "string" ||
    typeof data.email !== "string" || typeof data.country !== "string") return null;
  return { name: data.name, email: data.email, country: data.country };
}
