import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../packages/db/src/database.generated";
import { createGate2OfferPushLedger } from "./gate2-offer-push-db";

const inviteId = "11111111-1111-4111-8111-111111111111";
const outboxId = "22222222-2222-4222-8222-222222222222";
const deliveryId = "33333333-3333-4333-8333-333333333333";
const claimId = "44444444-4444-4444-8444-444444444444";
const respondentId = "55555555-5555-4555-8555-555555555555";
const client = (rpc: ReturnType<typeof vi.fn>) =>
  ({ rpc } as unknown as SupabaseClient<Database>);

describe("private matched-offer push adapter", () => {
  it("maps only validated claim identities and endpoint material", async () => {
    const rpc = vi.fn().mockImplementation(async (name) => ({ error: null,
      data: name === "list_gate2_offer_push_candidates" ? [inviteId] :
        name === "queue_gate2_offer_push" ? true :
        name === "list_gate2_offer_push_dispatchable" ? [outboxId] :
        name === "prepare_gate2_offer_push_deliveries" ? [deliveryId] :
        name === "claim_gate2_offer_push_delivery" ? {
          deliveryId, claimId, inviteId, respondentId,
          expiresAt: "2026-11-27T00:00:00Z",
          endpoint: "https://push.example.test/send",
          keys: { p256dh: "synthetic", auth: "synthetic" } } : true,
    }));
    const ledger = createGate2OfferPushLedger(client(rpc));
    expect(await ledger.readCandidates()).toEqual([inviteId]);
    expect(await ledger.enqueue(inviteId)).toBe(true);
    expect(await ledger.listDispatchable()).toEqual([outboxId]);
    expect(await ledger.prepare(outboxId)).toEqual([deliveryId]);
    expect(await ledger.claim(deliveryId, claimId)).toMatchObject({
      deliveryId, claimId, inviteId, respondentId });
    expect(await ledger.observe(deliveryId, claimId, "sent")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("queue_gate2_offer_push",
      { supplied_invite_id: inviteId });
    expect(rpc).toHaveBeenCalledWith("claim_gate2_offer_push_delivery",
      { supplied_delivery_id: deliveryId, supplied_claim_id: claimId });
  });
  it("rejects an unrelated or malformed private claim", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null,
      data: { deliveryId, claimId, inviteId, respondentId,
        expiresAt: "2026-11-27T00:00:00Z",
        endpoint: "https://push.example.test/send",
        keys: { p256dh: "synthetic", auth: "synthetic" } } });
    const ledger = createGate2OfferPushLedger(client(rpc));
    await expect(ledger.claim(inviteId, claimId)).rejects.toThrow("Invalid private offer push claim");
    await expect(ledger.enqueue("not-a-uuid")).rejects.toThrow("Invalid offer identity");
  });
});
