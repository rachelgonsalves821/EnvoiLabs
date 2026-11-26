import type { SupabaseClient } from "@supabase/supabase-js";
import { PayoutReservationDenied,
  type BatchReservation, type PayoutBatchDatabase,
  type PayoutDatabase, type Reservation } from "@envoi-labs/services/payout";
import type { Database } from "../../../../packages/db/src/database.generated";
import type { SandboxWebhookClaim } from "./gate2-tremendous-webhook-process";

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

function batchReservation(value: unknown, respondentId: string): BatchReservation | null {
  if (!object(value) || value.status !== "reserved" || !uuid(value.payoutId) ||
    !uuid(value.batchId) || value.respondentId !== respondentId ||
    value.recipientId !== value.payoutId ||
    typeof value.productId !== "string" || !value.productId ||
    !Number.isSafeInteger(value.amountCents) || (value.amountCents as number) <= 0 ||
    !["pending", "ordered", "delivered", "failed"].includes(String(value.payoutState)) ||
    !(value.providerOrderId === null || typeof value.providerOrderId === "string"))
    return null;
  return { id: value.payoutId, batchId: value.batchId,
    respondentId, recipientId: value.recipientId,
    productId: value.productId, amountCents: value.amountCents,
    state: value.payoutState, providerOrderId: value.providerOrderId } as BatchReservation;
}

export function createGate2SandboxBatchPayoutDatabase(client: SupabaseClient<Database>,
  annualCapCents: number): PayoutBatchDatabase {
  const single = createGate2SandboxPayoutDatabase(client, annualCapCents);
  return {
    async reserveBatchPayout(respondentId, requestId) {
      if (!uuid(respondentId) || !uuid(requestId))
        throw new PayoutReservationDenied();
      const { data, error } = await client.rpc("reserve_gate2_sandbox_visa_batch", {
        requested_respondent_id: respondentId,
        requested_request_id: requestId, annual_cap_cents: annualCapCents });
      if (error) {
        if (["23514", "23505", "42501"].includes(error.code))
          throw new PayoutReservationDenied();
        throw error;
      }
      if (object(data) && data.status === "below_minimum" &&
        Number.isSafeInteger(data.minimumCents) && (data.minimumCents as number) > 0)
        return { status: "below_minimum" };
      const saved = batchReservation(data, respondentId);
      if (!saved) throw new Error("Invalid frozen sandbox batch intent");
      return saved;
    },
    recordOrder: single.recordOrder,
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

export async function readGate2SandboxWebhookClaim(
  client: SupabaseClient<Database>, payoutId: string,
): Promise<SandboxWebhookClaim | null> {
  if (!uuid(payoutId)) return null;
  const { data, error } = await client.rpc("read_gate2_sandbox_visa_webhook_claim", {
    requested_payout_id: payoutId,
  });
  if (error) throw error;
  if (!object(data)) return null;
  if (data.id !== payoutId || data.recipientId !== payoutId ||
    typeof data.productId !== "string" || !data.productId ||
    !Number.isSafeInteger(data.amountCents) || (data.amountCents as number) <= 0 ||
    !["pending", "ordered", "delivered", "failed"].includes(String(data.state)) ||
    !(data.providerOrderId === null || typeof data.providerOrderId === "string"))
    throw new Error("Invalid sandbox webhook claim");
  return data as SandboxWebhookClaim;
}
