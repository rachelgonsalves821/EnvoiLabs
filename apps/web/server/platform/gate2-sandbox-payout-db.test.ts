import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../packages/db/src/database.generated";
import { createGate2SandboxBatchPayoutDatabase, createGate2SandboxPayoutDatabase,
  readGate2SandboxPayoutRecipient, readGate2SandboxWebhookClaim } from
  "./gate2-sandbox-payout-db";

const id = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const saved = { id, sessionId, respondentId: "33333333-3333-4333-8333-333333333333",
  recipientId: id, productId: "sandbox_visa", amountCents: 300,
  state: "pending", providerOrderId: null };
const client = (rpc: ReturnType<typeof vi.fn>) =>
  ({ rpc } as unknown as SupabaseClient<Database>);

describe("frozen sandbox Visa database adapter", () => {
  it("reads only an exact frozen test webhook claim", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      id, recipientId: id, productId: "sandbox_visa", amountCents: 1200,
      state: "ordered", providerOrderId: "ORDERBATCH1" }, error: null });
    expect(await readGate2SandboxWebhookClaim(client(rpc), id)).toMatchObject({
      id, amountCents: 1200, providerOrderId: "ORDERBATCH1" });
    expect(rpc).toHaveBeenCalledWith("read_gate2_sandbox_visa_webhook_claim",
      { requested_payout_id: id });
    expect(await readGate2SandboxWebhookClaim(client(rpc), "bad-id")).toBeNull();
    rpc.mockResolvedValue({ data: { id, recipientId: "other",
      productId: "sandbox_visa", amountCents: 1200,
      state: "ordered", providerOrderId: "ORDERBATCH1" }, error: null });
    await expect(readGate2SandboxWebhookClaim(client(rpc), id))
      .rejects.toThrow("Invalid sandbox webhook claim");
  });
  it("reserves by the exact stable session key and observes the frozen route", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
      .mockResolvedValueOnce({ data: saved, error: null });
    const db = createGate2SandboxPayoutDatabase(client(rpc), 200000);
    expect(await db.reserveSessionPayout(sessionId, `payout:${sessionId}`)).toEqual(saved);
    expect(rpc).toHaveBeenNthCalledWith(1, "reserve_gate2_sandbox_visa_intent",
      { requested_session_id: sessionId, annual_cap_cents: 200000 });
    expect(await db.claimIssuer(id)).toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(2, "claim_gate2_payout_issuer",
      { supplied_payout_id: id, supplied_origin: "test_provider" });
    await db.recordOrder(id, { id: "ORDER-1", eventId: "evt_ordered",
      recipientId: id, productId: "sandbox_visa", amountCents: 300,
      status: "ordered", observedAt: "2026-11-25T02:00:00Z" });
    expect(rpc).toHaveBeenNthCalledWith(3,
      "record_gate2_sandbox_visa_observation", expect.objectContaining({
        requested_payout_id: id, requested_recipient_id: id,
        requested_product_id: "sandbox_visa", requested_amount_cents: 300 }));
  });

  it("uses the separate mock issuer only after ordinary reservation", async () => {
    const serviceRpc = vi.fn().mockResolvedValue({ data: saved, error: null });
    const issuerRpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const db = createGate2SandboxPayoutDatabase(client(serviceRpc), 200000,
      true, client(issuerRpc));
    await db.reserveSessionPayout(sessionId, `payout:${sessionId}`);
    expect(await db.claimIssuer(id)).toBe(true);
    await db.recordOrder(id, { id: "ORDER-FICTIONAL", eventId: "evt_mock",
      recipientId: id, productId: "sandbox_visa", amountCents: 300,
      status: "ordered", observedAt: "2026-11-25T02:00:00Z" });
    expect(serviceRpc).toHaveBeenCalledOnce();
    expect(issuerRpc).toHaveBeenCalledWith("claim_gate2_payout_issuer",
      { supplied_payout_id: id, supplied_origin: "fictional" });
    expect(issuerRpc).toHaveBeenCalledWith(
      "record_gate2_fictional_sandbox_visa_observation",
      expect.objectContaining({ requested_payout_id: id }));
  });

  it("keeps policy denial separate from a transient database failure", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null,
      error: { code: "23514", message: "below Visa minimum" } })
      .mockResolvedValueOnce({ data: null,
        error: { code: "PGRST500", message: "database unavailable" } });
    const db = createGate2SandboxPayoutDatabase(client(rpc), 200000);
    await expect(db.reserveSessionPayout(sessionId, `payout:${sessionId}`))
      .rejects.toThrow("Payout reservation denied");
    await expect(db.reserveSessionPayout(sessionId, `payout:${sessionId}`))
      .rejects.toMatchObject({ code: "PGRST500" });
    await expect(db.reserveSessionPayout(sessionId, "different-key"))
      .rejects.toThrow("Payout reservation denied");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("rejects a cross-recipient observation before the database call", async () => {
    const rpc = vi.fn();
    const db = createGate2SandboxPayoutDatabase(client(rpc), 200000);
    await expect(db.recordOrder(id, { id: "ORDER-1", eventId: "event",
      recipientId: sessionId, productId: "sandbox_visa", amountCents: 300,
      status: "ordered", observedAt: "2026-11-25T02:00:00Z" }))
      .rejects.toThrow("Invalid sandbox payout observation");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reads a recipient only through the restricted frozen-intent RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { name: "Synthetic Person",
      email: "synthetic@example.test", country: "US" }, error: null });
    expect(await readGate2SandboxPayoutRecipient(client(rpc), id)).toEqual({
      name: "Synthetic Person", email: "synthetic@example.test", country: "US" });
    expect(rpc).toHaveBeenCalledWith("read_gate2_sandbox_visa_recipient",
      { requested_payout_id: id });
    expect(await readGate2SandboxPayoutRecipient(client(rpc), "bad-id")).toBeNull();
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("maps a frozen four-session batch to one payout and stable request ID", async () => {
    const respondentId = saved.respondentId;
    const requestId = "44444444-4444-4444-8444-444444444444";
    const batchId = "55555555-5555-4555-8555-555555555555";
    const rpc = vi.fn().mockResolvedValueOnce({ data: {
      status: "reserved", payoutId: id, batchId, respondentId,
      recipientId: id, productId: "sandbox_visa", amountCents: 1200,
      payoutState: "pending", providerOrderId: null }, error: null })
      .mockResolvedValueOnce({ data: { status: "below_minimum",
        minimumCents: 1000 }, error: null });
    const db = createGate2SandboxBatchPayoutDatabase(client(rpc), 200000);
    expect(await db.reserveBatchPayout(respondentId, requestId)).toEqual({
      id, batchId, respondentId, recipientId: id, productId: "sandbox_visa",
      amountCents: 1200, state: "pending", providerOrderId: null });
    expect(rpc).toHaveBeenNthCalledWith(1, "reserve_gate2_sandbox_visa_batch", {
      requested_respondent_id: respondentId, requested_request_id: requestId,
      annual_cap_cents: 200000 });
    expect(await db.reserveBatchPayout(respondentId, requestId))
      .toEqual({ status: "below_minimum" });
  });

  it("fails closed on a batch whose recipient or respondent changes", async () => {
    const respondentId = saved.respondentId;
    const requestId = "44444444-4444-4444-8444-444444444444";
    const rpc = vi.fn().mockResolvedValue({ data: { status: "reserved",
      payoutId: id, batchId: "55555555-5555-4555-8555-555555555555",
      respondentId: "other", recipientId: id,
      productId: "sandbox_visa", amountCents: 1200,
      payoutState: "pending", providerOrderId: null }, error: null });
    const db = createGate2SandboxBatchPayoutDatabase(client(rpc), 200000);
    await expect(db.reserveBatchPayout(respondentId, requestId))
      .rejects.toThrow("Invalid frozen sandbox batch intent");
  });
});
