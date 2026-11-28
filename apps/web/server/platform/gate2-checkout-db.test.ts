import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../packages/db/src/database.generated";
import { QuoteV4Schema } from "@envoi-labs/contracts";
import { createGate2CheckoutDatabase, mapGate2Quote } from "./gate2-checkout-db";

const studyId = "90600000-0000-4000-8000-000000000001";
const quoteId = "a9900000-0000-4000-8000-000000000001";
const organizationId = "90100000-0000-4000-8000-000000000001";
const researcher = { id: "90400000-0000-4000-8000-000000000001", organizationId,
  authUserId: "90200000-0000-4000-8000-000000000001" };
const feasibility = { studyId, eligibleProfileCount: 12,
  history: { offered: 1, accepted: 1, completed: 1 },
  projectedCompletes: null, fillHours: null,
  basis: "insufficient_history" as const, asOf: "2026-11-24T20:00:00.000Z" };
const session = { id: "cs_test_1", studyId, quoteId,
  pricingConfigVersion: 101, amountCents: 10_000, currency: "usd" as const,
  status: "open" as const, url: "https://checkout.stripe.test/cs_test_1" };

function fixture({ otherOrganization = false, existingCheckout = false,
  markerRejected = false } = {}) {
  const rows: Record<string, Record<string, unknown>[]> = {
    researchers: [{ id: researcher.id, organization_id: organizationId,
      auth_user_id: researcher.authUserId }],
    studies: [{ id: studyId, organization_id: otherOrganization ? "other" : organizationId,
      state: "brief_ready", target_completes: 10,
      deadline_at: "2999-11-24T20:00:00.000Z" }],
    brief_versions: [{ study_id: studyId, version: 1 }],
    guide_questions: Array.from({ length: 5 }, (_, index) => ({ study_id: studyId, position: index + 1 })),
    organizations: [{ id: organizationId, pricing_override_id: null }],
    pricing_configs: [{ id: "a9900000-0000-4000-8000-000000000002", version: 101,
      marketplace_active: true, params_json: { unitPriceCents: 200, incentivePerQuestionCents: 100 } }],
    gate2_quote_snapshots: [{ id: quoteId, study_id: studyId, brief_version: 1,
      guide_digest: "a".repeat(64), pricing_config_id: "a9900000-0000-4000-8000-000000000002",
      pricing_config_version: 101, currency: "usd", total_cents: 10_000,
      incentive_cents_per_complete: 500, line_items_json: [{ label: "Core questions",
        coreQuestionCount: 5, respondentCount: 10, unitPriceCents: 200, amountCents: 10_000 }],
      feasibility_json: feasibility, created_at: "2026-11-23T20:00:00Z" }],
    gate2_payment_events: existingCheckout ? [{ quote_id: quoteId, study_id: studyId,
      provider_checkout_id: session.id, provider_event_id: `checkout-created:${session.id}`,
      event_kind: "checkout_created", amount_cents: 10_000, currency: "usd",
      observation_origin: "provider" }] : [],
  };
  const from = vi.fn((table: string) => {
    let values = [...(rows[table] ?? [])];
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => { values = values.filter((row) => row[field] === value); return query; },
      order: (field: string, options: { ascending: boolean }) => {
        values.sort((a, b) => options.ascending
          ? Number(a[field]) - Number(b[field]) : Number(b[field]) - Number(a[field])); return query;
      },
      limit: (count: number) => { values = values.slice(0, count); return query; },
      maybeSingle: async () => ({ data: values[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: values, error: null }),
      insert: async (row: Record<string, unknown>) => {
        if (rows[table]?.some((existing) => existing.quote_id === row.quote_id &&
          existing.event_kind === "checkout_created")) return { error: { code: "23505" } };
        rows[table]!.push(row); return { error: null };
      },
    };
    return query;
  });
  const rpc = vi.fn(async (name: string) => ({ data:
    name === "read_gate2_marketplace_feasibility" ? feasibility :
      name === "freeze_gate2_marketplace_quote" ? quoteId :
      name === "mark_gate2_fictional_quote" ? !markerRejected : existingCheckout
        ? name === "read_gate2_fictional_quote" ? false
          : { status: "known", checkoutId: session.id }
        : name === "read_gate2_fictional_quote" ? false
        : { status: "create", key: `gate2-checkout:${quoteId}` }, error: null }));
  const client = { from, rpc } as unknown as SupabaseClient<Database>;
  return { db: createGate2CheckoutDatabase(client, researcher), from, rpc, rows };
}

describe("Gate 2 checkout database scope", () => {
  it("normalizes PostgreSQL timestamp offsets for the frozen quote contract", () => {
    const { rows } = fixture();
    const quoteRow = rows.gate2_quote_snapshots![0]!;
    quoteRow.created_at = "2026-11-23T20:00:00+00:00";
    const parsed = QuoteV4Schema.safeParse(mapGate2Quote(
      quoteRow as unknown as Database["public"]["Tables"]["gate2_quote_snapshots"]["Row"]));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.createdAt).toBe("2026-11-23T20:00:00.000Z");
  });
  it("reads the approved scope and selected version, then freezes exact economics", async () => {
    const { db, rpc } = fixture();
    expect(await db.readApprovedScope(studyId)).toEqual({ studyId, briefVersion: 1,
      coreQuestionCount: 5, targetRespondents: 10,
      feasibility });
    expect(await db.readSelectedPricing(studyId)).toEqual({ id: "a9900000-0000-4000-8000-000000000002",
      version: 101, unitPriceCents: 200, incentivePerQuestionCents: 100 });
    expect(await db.freezeQuote({ studyId, briefVersion: 1,
      pricingConfigId: "a9900000-0000-4000-8000-000000000002", pricingConfigVersion: 101,
      lineItems: [{ label: "Core questions", coreQuestionCount: 5, respondentCount: 10,
        unitPriceCents: 200, amountCents: 10_000 }], totalCents: 10_000,
      incentiveCentsPerComplete: 500, feasibility }))
      .toBe(quoteId);
    expect(rpc).toHaveBeenCalledWith("freeze_gate2_marketplace_quote", expect.objectContaining({
      supplied_study_id: studyId, supplied_total_cents: 10_000,
      supplied_config_version: 101 }));
  });

  it("rejects another organization's study before quote or checkout writes", async () => {
    const { db, rpc, rows } = fixture({ otherOrganization: true });
    expect(await db.readApprovedScope(studyId)).toBeNull();
    expect(await db.readSelectedPricing(studyId)).toBeNull();
    expect(await db.claimCheckoutIntent(studyId, quoteId)).toEqual({ status: "blocked" });
    await expect(db.recordCheckoutCreated(session, `checkout-created:${session.id}`,
      "2026-11-23T20:00:00Z")).rejects.toThrow("scope");
    expect(rpc).not.toHaveBeenCalled();
    expect(rows.gate2_payment_events).toHaveLength(0);
  });

  it("does not prepare marketplace checkout without a future fieldwork deadline", async () => {
    const { db, rows } = fixture();
    rows.studies![0]!.deadline_at = null;
    expect(await db.readApprovedScope(studyId)).toBeNull();
    rows.studies![0]!.deadline_at = "2000-01-01T00:00:00.000Z";
    expect(await db.readApprovedScope(studyId)).toBeNull();
  });

  it("accepts an exact checkout replay and refuses a conflicting identity", async () => {
    const { db } = fixture({ existingCheckout: true });
    expect(await db.claimCheckoutIntent(studyId, quoteId)).toEqual({ status: "known",
      checkoutId: session.id, fictional: false });
    await expect(db.recordCheckoutCreated(session, `checkout-created:${session.id}`,
      "2026-11-23T20:00:00Z")).resolves.toBeUndefined();
    await expect(db.recordCheckoutCreated({ ...session, id: "cs_other" }, "checkout-created:cs_other",
      "2026-11-23T20:00:00Z")).rejects.toEqual({ code: "23505" });
  });

  it("requires the fictional marker before its mock checkout event", async () => {
    const { db, rpc, rows } = fixture();
    const fictional = { ...session, simulationProvenance: "fictional" as const };
    expect(await db.markFictionalQuote(quoteId)).toBe(true);
    await db.recordCheckoutCreated(fictional, `checkout-created:${session.id}`,
      "2026-11-23T20:00:00Z");
    expect(rpc).toHaveBeenCalledWith("mark_gate2_fictional_quote",
      { supplied_quote_id: quoteId });
    expect(rows.gate2_payment_events).toHaveLength(1);
    expect(rows.gate2_payment_events![0]!.observation_origin).toBe("fictional");
    const denied = fixture({ markerRejected: true });
    expect(await denied.db.markFictionalQuote(quoteId)).toBe(false);
    expect(denied.rows.gate2_payment_events).toHaveLength(0);
  });
});
