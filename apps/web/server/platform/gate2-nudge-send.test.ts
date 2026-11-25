import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../../../packages/db/src/database.generated";
import { deliverGate2Nudges } from "./gate2-nudge-send";

const outboxId = "11111111-1111-4111-8111-111111111111";
const deliveryId = "22222222-2222-4222-8222-222222222222";
const inviteId = "33333333-3333-4333-8333-333333333333";
const respondentId = "44444444-4444-4444-8444-444444444444";

afterEach(() => vi.unstubAllEnvs());

describe("disabled Gate 2 push sender seam", () => {
  it("makes no database or transport call by default", async () => {
    const rpc = vi.fn();
    const send = vi.fn();
    expect(await deliverGate2Nudges({ rpc } as unknown as SupabaseClient<Database>,
      { send })).toEqual({ prepared: 0, sent: 0, failed: 0, unresolved: 0 });
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("binds a test transport payload to a signed resume path and exact claim", async () => {
    vi.stubEnv("ENVOI_GATE2_PUSH_DELIVERY_ENABLED", "true");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-resume-signing-secret");
    const rpc = vi.fn(async (name: string, args?: Record<string, string>) => {
      if (name === "list_gate2_nudge_dispatchable") return { data: [outboxId], error: null };
      if (name === "prepare_gate2_nudge_deliveries") return { data: [deliveryId], error: null };
      if (name === "claim_gate2_nudge_delivery") return { data: {
        deliveryId, claimId: args?.supplied_claim_id, inviteId, respondentId,
        expiresAt: "2026-11-25T23:00:00.000Z", kind: "two_hours_left",
        endpoint: "https://push.example.test/one",
        keys: { p256dh: "public-key", auth: "auth-key" },
      }, error: null };
      if (name === "observe_gate2_nudge_delivery") return { data: true, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const send = vi.fn().mockResolvedValue("sent");
    const result = await deliverGate2Nudges(
      { rpc } as unknown as SupabaseClient<Database>, { send },
      () => new Date("2026-11-25T20:00:00.000Z"));
    expect(result).toEqual({ prepared: 1, sent: 1, failed: 0, unresolved: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      kind: "two_hours_left", path: expect.stringMatching(/^\/r\/s\//),
    });
    const claimId = rpc.mock.calls.find(([name]) => name === "claim_gate2_nudge_delivery")?.[1]?.supplied_claim_id;
    expect(rpc.mock.calls.find(([name]) => name === "observe_gate2_nudge_delivery")?.[1])
      .toMatchObject({ supplied_delivery_id: deliveryId, supplied_claim_id: claimId,
        supplied_state: "sent" });
  });
});
