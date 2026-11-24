import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../packages/db/src/database.generated";
import { createGate2PaidStudyDatabase } from "./gate2-paid-study-db";

const studyId = "90600000-0000-4000-8000-000000000001";
const quoteId = "a9900000-0000-4000-8000-000000000001";
const observedAt = "2026-11-23T20:00:00.000Z";
const observation = { id: "cs_test_1", eventId: "evt_paid_1", studyId, quoteId,
  pricingConfigVersion: 100, amountCents: 500, currency: "usd", status: "paid" as const,
  refundedCents: 0, observedAt };

function fixture() {
  const rows: Record<string, Record<string, unknown>[]> = {
    gate2_quote_snapshots: [{ id: quoteId, study_id: studyId, brief_version: 1,
      guide_digest: "a".repeat(64), pricing_config_id: "a9900000-0000-4000-8000-000000000002",
      pricing_config_version: 100, currency: "usd", total_cents: 500,
      incentive_cents_per_complete: 200, line_items_json: [{ label: "Core questions",
        coreQuestionCount: 5, respondentCount: 1, unitPriceCents: 100, amountCents: 500 }],
      feasibility_json: { expectedCompletes: 1, hours: 24 }, created_at: observedAt }],
    gate2_payment_events: [{ quote_id: quoteId, study_id: studyId,
      provider_checkout_id: observation.id, provider_event_id: "checkout-created:cs_test_1",
      event_kind: "checkout_created", amount_cents: 500, currency: "usd",
      provider_observed_at: observedAt }],
  };
  const from = vi.fn((table: string) => {
    let values = [...(rows[table] ?? [])];
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { values = values.filter((row) => row[field] === value); return query; },
      maybeSingle: async () => ({ data: values[0] ?? null, error: null }),
      insert: async (row: Record<string, unknown>) => {
        if (rows[table]!.some((prior) => prior.provider_event_id === row.provider_event_id)) {
          return { error: { code: "23505" } };
        }
        rows[table]!.push(row); return { error: null };
      },
    };
    return query;
  });
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const db = createGate2PaidStudyDatabase({ from, rpc } as unknown as SupabaseClient<Database>);
  return { db, rows, rpc };
}

describe("Gate 2 paid study database adapter", () => {
  it("records a bound paid event once and replays the exact event without another effect", async () => {
    const { db, rows, rpc } = fixture();
    expect(await db.readCheckoutId(quoteId)).toBe(observation.id);
    expect(await db.readQuote(studyId, quoteId)).toMatchObject({ id: quoteId,
      totalCents: 500, pricingConfigVersion: 100 });
    await db.recordObservation(observation);
    await db.recordObservation(observation);
    await db.recordObservation({ ...observation, observedAt: "2026-11-24T10:00:00.000Z" });
    expect(rows.gate2_payment_events).toHaveLength(2);
    expect(await db.launchPaidStudy(studyId, quoteId, observation.eventId)).toBe(true);
    expect(rpc).toHaveBeenCalledWith("launch_gate2_paid_study", {
      supplied_study_id: studyId, supplied_quote_id: quoteId,
      supplied_provider_event_id: observation.eventId });
  });

  it("persists refund and failure evidence with their actual event amounts", async () => {
    const { db, rows } = fixture();
    await db.recordObservation({ ...observation, eventId: "evt_refund_1",
      status: "refunded", refundedCents: 200 });
    await db.recordObservation({ ...observation, eventId: "evt_failed_1", status: "failed" });
    expect(rows.gate2_payment_events!.slice(1).map(({ event_kind, amount_cents }) =>
      ({ event_kind, amount_cents }))).toEqual([
      { event_kind: "refunded", amount_cents: 200 },
      { event_kind: "failed", amount_cents: 500 },
    ]);
  });

  it("refuses a provider mismatch or conflicting replay before launch", async () => {
    const { db, rows, rpc } = fixture();
    await expect(db.recordObservation({ ...observation, id: "cs_other" }))
      .rejects.toThrow("frozen checkout");
    await db.recordObservation(observation);
    await expect(db.recordObservation({ ...observation, status: "failed" }))
      .rejects.toEqual({ code: "23505" });
    expect(rows.gate2_payment_events).toHaveLength(2);
    expect(rpc).not.toHaveBeenCalled();
  });
});
