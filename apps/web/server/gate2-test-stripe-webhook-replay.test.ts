import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/webhooks/stripe-test/route";

const { trusted, getCheckout } = vi.hoisted(() => ({
  trusted: vi.fn(), getCheckout: vi.fn(),
}));
vi.mock("./auth/supabase", async (original) => ({
  ...await original<typeof import("./auth/supabase")>(),
  trustedClient: trusted,
}));
vi.mock("./platform/gate2-stripe-payment-test", () => ({
  createStripeTestPaymentObserver: () => ({ getCheckout }),
}));

const studyId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
const checkoutId = "cs_test_replay_fixture";
const observedAt = "2026-11-25T00:00:00.000Z";
const event = JSON.stringify({ id: "evt_test_replay", object: "event", livemode: false,
  type: "checkout.session.completed",
  data: { object: { object: "checkout.session", id: checkoutId } } });

function signedRequest(body = event) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", "whsec_fixture")
    .update(`${timestamp}.${body}`).digest("hex");
  return new NextRequest("https://labs.example.test/api/webhooks/stripe-test", {
    method: "POST", body,
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
  });
}

function fixture() {
  const quote = { id: quoteId, study_id: studyId, brief_version: 1,
    guide_digest: "a".repeat(64), pricing_config_id: quoteId,
    pricing_config_version: 101, currency: "usd", total_cents: 10_000,
    incentive_cents_per_complete: 500,
    line_items_json: [{ label: "Core questions", coreQuestionCount: 5,
      respondentCount: 10, unitPriceCents: 200, amountCents: 10_000 }],
    feasibility_json: { studyId, eligibleProfileCount: 10,
      history: { offered: 0, accepted: 0, completed: 0 },
      projectedCompletes: null, fillHours: null,
      basis: "insufficient_history", asOf: observedAt },
    created_at: observedAt };
  const rows: Record<string, Record<string, unknown>[]> = {
    gate2_quote_snapshots: [quote],
    gate2_payment_events: [{ quote_id: quoteId, study_id: studyId,
      provider_checkout_id: checkoutId,
      provider_event_id: `checkout-created:${checkoutId}`,
      event_kind: "checkout_created", amount_cents: 10_000,
      currency: "usd", provider_observed_at: observedAt }],
  };
  let launches = 0;
  let offers = 0;
  const client = {
    from(table: string) {
      let selected = [...(rows[table] ?? [])];
      const query = {
        select: () => query,
        eq(field: string, value: unknown) {
          selected = selected.filter((row) => row[field] === value);
          return query;
        },
        maybeSingle: async () => ({ data: selected[0] ?? null, error: null }),
        insert: async (row: Record<string, unknown>) => {
          if (rows[table]!.some((prior) =>
            prior.provider_event_id === row.provider_event_id))
            return { error: { code: "23505" } };
          rows[table]!.push(row);
          return { error: null };
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (args.supplied_study_id !== studyId || args.supplied_quote_id !== quoteId)
        return { data: null, error: { code: "23514" } };
      if (name === "launch_gate2_paid_study_checked") {
        if (launches === 0) launches++;
        return { data: true, error: null };
      }
      if (name === "create_gate2_paid_launch_wave") {
        const created = offers === 0 ? 10 : 0;
        offers += created;
        return { data: { created, remaining: 0 }, error: null };
      }
      return { data: null, error: { code: "42883" } };
    },
  };
  trusted.mockReturnValue(client);
  getCheckout.mockResolvedValue({ id: checkoutId,
    eventId: `stripe-checkout-state:${checkoutId}:paid:0`, studyId, quoteId,
    pricingConfigVersion: 101, amountCents: 10_000, currency: "usd",
    status: "paid", refundedCents: 0, observedAt });
  return { rows, count: () => ({ launches, offers }) };
}

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("Stripe test webhook replay across the route and ledger", () => {
  it("authenticates the hint and reconciles one frozen paid effect across three deliveries", async () => {
    vi.stubEnv("ENVOI_GATE2_TEST_WEBHOOK_ENABLED", "true");
    vi.stubEnv("STRIPE_TEST_WEBHOOK_SECRET", "whsec_fixture");
    vi.stubEnv("STRIPE_TEST_SECRET_KEY", "sk_test_fixture");
    const { rows, count } = fixture();
    for (let n = 0; n < 3; n++) {
      const response = await POST(signedRequest());
      expect(response.status).toBe(200);
      expect((await response.json()).status).toBe("launched");
    }
    expect(getCheckout).toHaveBeenCalledTimes(3);
    expect(rows.gate2_payment_events).toHaveLength(2);
    expect(rows.gate2_payment_events![1]).toMatchObject({
      quote_id: quoteId, event_kind: "paid", amount_cents: 10_000,
    });
    expect(count()).toEqual({ launches: 1, offers: 10 });
  });
});
