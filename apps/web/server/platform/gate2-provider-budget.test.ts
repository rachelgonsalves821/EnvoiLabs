import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../packages/db/src/database.generated";
import { takeGate2TestProviderBudget } from "./gate2-provider-budget";

const studyId = "90600000-0000-4000-8000-000000000001";
const authUserId = "90200000-0000-4000-8000-000000000001";

describe("test-provider request budget adapter", () => {
  it("uses one scoped RPC for checkout creation and reconciliation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "allow", used: 1 }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    expect(await takeGate2TestProviderBudget(client, studyId, authUserId))
      .toEqual({ status: "allow" });
    expect(rpc).toHaveBeenCalledWith("consume_gate2_test_provider_budget", {
      supplied_study_id: studyId, supplied_auth_user_id: authUserId,
    });
  });

  it("fails closed on missing or malformed budget responses", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST" } })
      .mockResolvedValueOnce({ data: { status: "limited", retryAfterSeconds: 0 }, error: null })
      .mockResolvedValueOnce({ data: { status: "limited", retryAfterSeconds: 42 }, error: null })
      .mockResolvedValueOnce({ data: { status: "blocked" }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    expect(await takeGate2TestProviderBudget(client, studyId, authUserId))
      .toEqual({ status: "unavailable" });
    expect(await takeGate2TestProviderBudget(client, studyId, authUserId))
      .toEqual({ status: "unavailable" });
    expect(await takeGate2TestProviderBudget(client, studyId, authUserId))
      .toEqual({ status: "limited", retryAfterSeconds: 42 });
    expect(await takeGate2TestProviderBudget(client, studyId, authUserId))
      .toEqual({ status: "blocked" });
  });
});
