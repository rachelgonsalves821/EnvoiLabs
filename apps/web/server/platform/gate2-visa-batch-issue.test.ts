import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../packages/db/src/database.generated";
import { issueGate2SandboxVisaBatch } from "./gate2-visa-batch-issue";

const payoutId = "11111111-1111-4111-8111-111111111111";
const respondentId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const batchId = "44444444-4444-4444-8444-444444444444";
const key = `gate2-payout:${payoutId}`;
const recipient = { name: "Synthetic Batch Person", email: "batch@example.test",
  country: "US" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status,
    headers: { "content-type": "application/json" } });
const client = (rpc: ReturnType<typeof vi.fn>) =>
  ({ rpc } as unknown as SupabaseClient<Database>);

describe("synthetic Visa batch issue composition", () => {
  it("reserves, checks testflight catalog, reconciles delivery and keeps one key", async () => {
    const rpc = vi.fn().mockImplementation(async (name) => ({ error: null,
      data: name === "reserve_gate2_sandbox_visa_batch"
        ? { status: "reserved", payoutId, batchId, respondentId,
          recipientId: payoutId, productId: "sandbox_visa", amountCents: 1200,
          payoutState: "pending", providerOrderId: null }
        : name === "read_gate2_sandbox_visa_recipient" ? recipient : true }));
    const product = { id: "sandbox_visa", category: "visa_card",
      currency_codes: ["USD"], countries: [{ abbr: "US" }],
      skus: [{ min: 10, max: 500, currency_code: "USD" }] };
    const order = { id: "ORDER-BATCH-1", external_id: key,
      created_at: "2026-11-25T02:00:00Z", status: "EXECUTED",
      rewards: [{ products: ["sandbox_visa"],
        value: { denomination: 12, currency_code: "USD" },
        recipient: { name: recipient.name, email: recipient.email },
        delivery: { method: "EMAIL", status: "SUCCEEDED" } }] };
    const request = vi.fn().mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ products: [product] }))
      .mockResolvedValueOnce(json({ order }))
      .mockResolvedValueOnce(json({ order })) as unknown as typeof fetch;
    expect(await issueGate2SandboxVisaBatch({ client: client(rpc), apiKey: "TEST_fixture",
      respondentId, requestId, annualCapCents: 200000, request,
      fictionalProvider: true })).toBe("delivered");
    expect(rpc).toHaveBeenCalledWith("claim_gate2_payout_issuer",
      { supplied_payout_id: payoutId, supplied_origin: "fictional" });
    const markerCall = rpc.mock.calls.findIndex(([name]) =>
      name === "claim_gate2_payout_issuer");
    expect(markerCall).toBeGreaterThanOrEqual(0);
    expect(rpc.mock.invocationCallOrder[markerCall]!)
      .toBeLessThan((request as unknown as ReturnType<typeof vi.fn>)
        .mock.invocationCallOrder[0]!);
    expect(request).toHaveBeenCalledTimes(4);
    const calls = (request as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.filter(([url]) => url ===
      "https://testflight.tremendous.com/api/v2/orders")).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith("record_gate2_fictional_sandbox_visa_observation",
      expect.objectContaining({ requested_payout_id: payoutId,
        requested_recipient_id: payoutId, requested_product_id: "sandbox_visa",
        requested_amount_cents: 1200 }));
  });

  it("makes no provider request when the frozen batch is below the Visa floor", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null,
      data: { status: "below_minimum", minimumCents: 1000 } });
    const request = vi.fn() as unknown as typeof fetch;
    expect(await issueGate2SandboxVisaBatch({ client: client(rpc), apiKey: "TEST_fixture",
      respondentId, requestId, annualCapCents: 200000, request }))
      .toBe("below_minimum");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not call a mock provider if another issuer owns the durable claim", async () => {
    const rpc = vi.fn().mockImplementation(async (name) => ({ error: null,
      data: name === "reserve_gate2_sandbox_visa_batch"
        ? { status: "reserved", payoutId, batchId, respondentId,
          recipientId: payoutId, productId: "sandbox_visa", amountCents: 1200,
          payoutState: "pending", providerOrderId: null } : false }));
    const request = vi.fn() as unknown as typeof fetch;
    expect(await issueGate2SandboxVisaBatch({ client: client(rpc),
      apiKey: "TEST_fixture", respondentId, requestId, annualCapCents: 200000,
      request, fictionalProvider: true })).toBe("blocked");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects any non-testflight key before reservation or network access", async () => {
    const rpc = vi.fn();
    const request = vi.fn() as unknown as typeof fetch;
    await expect(issueGate2SandboxVisaBatch({ client: client(rpc), apiKey: "LIVE_key",
      respondentId, requestId, annualCapCents: 200000, request }))
      .rejects.toThrow("Sandbox key required");
    expect(rpc).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
