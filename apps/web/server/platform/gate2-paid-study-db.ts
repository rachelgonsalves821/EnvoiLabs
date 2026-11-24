import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckoutObservation, PaidStudyDatabase } from "@envoi-labs/services/paid-study";
import type { Database } from "../../../../packages/db/src/database.generated";
import { mapGate2Quote } from "./gate2-checkout-db";

type Tables = Database["public"]["Tables"];
type QuoteRow = Tables["gate2_quote_snapshots"]["Row"];
type PaymentEventRow = Tables["gate2_payment_events"]["Row"];

function readData<T>(result: { data: T | null; error: unknown }): T | null {
  if (result.error) throw result.error;
  return result.data;
}

export function createGate2PaidStudyDatabase(client: SupabaseClient<Database>): PaidStudyDatabase {
  return {
    async readQuote(studyId, quoteId) {
      const row = readData(await client.from("gate2_quote_snapshots").select("*")
        .eq("id", quoteId).eq("study_id", studyId).maybeSingle()) as QuoteRow | null;
      return row ? mapGate2Quote(row) : null;
    },
    async readCheckoutId(quoteId) {
      const row = readData(await client.from("gate2_payment_events").select("*")
        .eq("quote_id", quoteId).eq("event_kind", "checkout_created")
        .maybeSingle()) as PaymentEventRow | null;
      return row?.provider_checkout_id ?? null;
    },
    async recordObservation(observation: CheckoutObservation) {
      const quote = readData(await client.from("gate2_quote_snapshots").select("*")
        .eq("id", observation.quoteId).eq("study_id", observation.studyId)
        .maybeSingle()) as QuoteRow | null;
      const checkout = readData(await client.from("gate2_payment_events").select("*")
        .eq("quote_id", observation.quoteId).eq("event_kind", "checkout_created")
        .maybeSingle()) as PaymentEventRow | null;
      if (!quote || !checkout || checkout.provider_checkout_id !== observation.id ||
        quote.pricing_config_version !== observation.pricingConfigVersion ||
        quote.total_cents !== observation.amountCents || quote.currency !== observation.currency ||
        checkout.amount_cents !== quote.total_cents || checkout.currency !== quote.currency ||
        observation.status === "pending" ||
        (observation.status === "refunded" && observation.refundedCents <= 0)) {
        throw new Error("Provider observation does not match frozen checkout");
      }
      const refunded = observation.refundedCents > 0;
      const kind = refunded ? "refunded" : observation.status;
      const amount = refunded ? observation.refundedCents : observation.amountCents;
      const event = { quote_id: quote.id, study_id: quote.study_id,
        provider_checkout_id: checkout.provider_checkout_id,
        provider_event_id: observation.eventId, event_kind: kind,
        amount_cents: amount, currency: quote.currency,
        provider_observed_at: observation.observedAt };
      const { error } = await client.from("gate2_payment_events").insert(event);
      if (!error) return;
      if (error.code !== "23505") throw error;
      const prior = readData(await client.from("gate2_payment_events").select("*")
        .eq("provider_event_id", observation.eventId).maybeSingle()) as PaymentEventRow | null;
      if (!prior || prior.quote_id !== event.quote_id || prior.study_id !== event.study_id ||
        prior.provider_checkout_id !== event.provider_checkout_id ||
        prior.event_kind !== event.event_kind || prior.amount_cents !== event.amount_cents ||
        prior.currency !== event.currency ||
        Date.parse(prior.provider_observed_at) !== Date.parse(event.provider_observed_at)) {
        throw error;
      }
    },
    async launchPaidStudy(studyId, quoteId, providerEventId) {
      const result = readData(await client.rpc("launch_gate2_paid_study", {
        supplied_study_id: studyId, supplied_quote_id: quoteId,
        supplied_provider_event_id: providerEventId,
      }));
      return result === true;
    },
  };
}
