import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../../../packages/db/src/database.generated";
import { createGate2NudgeDeliveryLedger } from "./gate2-nudge-delivery-db";

const outboxId = "11111111-1111-4111-8111-111111111111";
const deliveryId = "22222222-2222-4222-8222-222222222222";
const claimId = "33333333-3333-4333-8333-333333333333";
const inviteId = "44444444-4444-4444-8444-444444444444";
const respondentId = "55555555-5555-4555-8555-555555555555";

function fixture() {
  const rpc = vi.fn();
  const ledger = createGate2NudgeDeliveryLedger({ rpc } as unknown as SupabaseClient<Database>);
  return { rpc, ledger };
}

describe("private nudge delivery database port", () => {
  it("uses service-only RPCs and binds each claim to its exact identity", async () => {
    const { rpc, ledger } = fixture();
    rpc.mockResolvedValueOnce({ data: [outboxId], error: null });
    rpc.mockResolvedValueOnce({ data: [deliveryId], error: null });
    rpc.mockResolvedValueOnce({ data: {
      deliveryId, claimId, inviteId, respondentId,
      expiresAt: "2026-11-25T23:00:00.000Z", kind: "halfway",
      endpoint: "https://push.example.test/one",
      keys: { p256dh: "public-key", auth: "auth-key" },
    }, error: null });
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await ledger.listDispatchable()).toEqual([outboxId]);
    expect(await ledger.prepare(outboxId)).toEqual([deliveryId]);
    expect(await ledger.claim(deliveryId, claimId)).toMatchObject({
      deliveryId, claimId, inviteId, respondentId, kind: "halfway",
    });
    expect(await ledger.observe(deliveryId, claimId, "sent")).toBe(true);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "list_gate2_nudge_dispatchable", "prepare_gate2_nudge_deliveries",
      "claim_gate2_nudge_delivery", "observe_gate2_nudge_delivery",
    ]);
  });

  it("refuses a mismatched claim or malformed private destination", async () => {
    const { rpc, ledger } = fixture();
    const base = { deliveryId, claimId, inviteId, respondentId,
      expiresAt: "2026-11-25T23:00:00.000Z", kind: "halfway",
      endpoint: "https://push.example.test/one",
      keys: { p256dh: "public-key", auth: "auth-key" } };
    rpc.mockResolvedValueOnce({ data: { ...base, claimId: "another" }, error: null });
    await expect(ledger.claim(deliveryId, claimId)).rejects.toThrow("Invalid private nudge claim");
    rpc.mockResolvedValueOnce({ data: { ...base, endpoint: "http://localhost/send" }, error: null });
    await expect(ledger.claim(deliveryId, claimId)).rejects.toThrow("Invalid private nudge claim");
    rpc.mockResolvedValueOnce({ data: { ...base, keys: { p256dh: "", auth: "auth-key" } }, error: null });
    await expect(ledger.claim(deliveryId, claimId)).rejects.toThrow("Invalid private nudge claim");
  });
});
