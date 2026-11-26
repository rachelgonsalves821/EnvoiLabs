import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../packages/db/src/database.generated";
import { issueGate2SandboxVisaReferral } from "./gate2-visa-referral-issue";

const vestingId = "11111111-1111-4111-8111-111111111111";
const payoutId = "22222222-2222-4222-8222-222222222222";
const respondentId = "33333333-3333-4333-8333-333333333333";
const client = (rpc: ReturnType<typeof vi.fn>) =>
  ({ rpc } as unknown as SupabaseClient<Database>);

describe("referral Visa TEST composition", () => {
  it("does not contact the provider when the $5 vesting is below SKU minimum", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null,
      data: { status: "below_minimum", bonusCents: 500, minimumCents: 1000 } });
    const request = vi.fn() as unknown as typeof fetch;
    expect(await issueGate2SandboxVisaReferral({ client: client(rpc),
      apiKey: "TEST_fixture", vestingId, annualCapCents: 200000, request }))
      .toBe("below_minimum");
    expect(rpc).toHaveBeenCalledWith("reserve_gate2_sandbox_visa_referral_bonus",
      { requested_vesting_id: vestingId, annual_cap_cents: 200000 });
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a mismatched frozen vesting before provider access", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null,
      data: { status: "reserved", payoutId, vestingId: respondentId,
        respondentId, recipientId: payoutId, productId: "sandbox_visa",
        amountCents: 500, payoutState: "pending", providerOrderId: null } });
    const request = vi.fn() as unknown as typeof fetch;
    expect(await issueGate2SandboxVisaReferral({ client: client(rpc),
      apiKey: "TEST_fixture", vestingId, annualCapCents: 200000, request }))
      .toBe("unavailable");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a live credential before reservation or provider access", async () => {
    const rpc = vi.fn();
    const request = vi.fn() as unknown as typeof fetch;
    await expect(issueGate2SandboxVisaReferral({ client: client(rpc),
      apiKey: "LIVE_bad", vestingId, annualCapCents: 200000, request }))
      .rejects.toThrow("Sandbox key required");
    expect(rpc).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
