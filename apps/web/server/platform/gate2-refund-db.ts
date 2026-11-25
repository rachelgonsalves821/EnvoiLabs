import type { SupabaseClient } from "@supabase/supabase-js";
import type { RefundClaim, RefundSettlementDatabase } from "@envoi-labs/services/refund-settlement";
import type { Database } from "../../../../packages/db/src/database.generated";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function parsed(value: unknown): RefundClaim {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { status: "unavailable" };
  const claim = value as Record<string, unknown>;
  if (claim.status === "unavailable") return { status: "unavailable" };
  if ((claim.status !== "create" && claim.status !== "known") ||
    typeof claim.checkoutId !== "string" ||
    !/^cs_test_[A-Za-z0-9_]+$/.test(claim.checkoutId) ||
    typeof claim.quoteId !== "string" || !uuid.test(claim.quoteId) ||
    typeof claim.studyId !== "string" || !uuid.test(claim.studyId) ||
    !Number.isSafeInteger(claim.amountCents) || (claim.amountCents as number) <= 0 ||
    !Number.isSafeInteger(claim.quoteTotalCents) ||
    (claim.quoteTotalCents as number) < (claim.amountCents as number) ||
    !Number.isSafeInteger(claim.pricingConfigVersion) ||
    (claim.pricingConfigVersion as number) < 101)
    return { status: "unavailable" };
  const common = { checkoutId: claim.checkoutId, quoteId: claim.quoteId,
    studyId: claim.studyId, amountCents: claim.amountCents as number,
    quoteTotalCents: claim.quoteTotalCents as number,
    pricingConfigVersion: claim.pricingConfigVersion as number };
  if (claim.status === "create") {
    if (claim.key !== `gate2-unfilled-refund:${claim.quoteId}`)
      return { status: "unavailable" };
    return { status: "create", ...common, key: claim.key };
  }
  if (typeof claim.refundId !== "string" ||
    !/^re_[A-Za-z0-9_]+$/.test(claim.refundId))
    return { status: "unavailable" };
  return { status: "known", ...common, refundId: claim.refundId };
}

export function createGate2RefundDatabase(client: SupabaseClient<Database>):
  RefundSettlementDatabase {
  return {
    async claim(reservationId, authUserId) {
      const { data, error } = await client.rpc("claim_gate2_refund_intent", {
        requested_reservation_id: reservationId,
        supplied_auth_user_id: authUserId,
      });
      if (error?.code === "23514" || error?.code === "42501")
        return { status: "blocked" };
      if (error) return { status: "unavailable" };
      return parsed(data);
    },
    async record(reservationId, observation) {
      const { data, error } = await client.rpc("record_gate2_refund_observation", {
        requested_reservation_id: reservationId,
        requested_refund_id: observation.refundId,
        requested_kind: observation.kind,
        requested_amount_cents: observation.amountCents,
        requested_observed_at: observation.observedAt,
      });
      return !error && data === true;
    },
  };
}
