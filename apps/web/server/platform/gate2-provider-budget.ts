import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../packages/db/src/database.generated";

export type ProviderBudget =
  | { status: "allow" }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "blocked" | "unavailable" };

// Both test-mode checkout POSTs use this one database counter before creating
// a provider client. RPC failure is unavailable and never permits a fetch.
export async function takeGate2TestProviderBudget(
  client: SupabaseClient<Database>, studyId: string, authUserId: string,
  purpose: "checkout" | "reconcile",
): Promise<ProviderBudget> {
  const { data, error } = await client.rpc("consume_gate2_test_provider_budget", {
    supplied_study_id: studyId, supplied_auth_user_id: authUserId,
    requested_units: purpose === "checkout" ? 1 : 3,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data))
    return { status: "unavailable" };
  const value = data as Record<string, unknown>;
  if (value.status === "allow") return { status: "allow" };
  if (value.status === "blocked") return { status: "blocked" };
  if (value.status === "limited" && Number.isInteger(value.retryAfterSeconds) &&
    typeof value.retryAfterSeconds === "number" &&
    value.retryAfterSeconds >= 1 && value.retryAfterSeconds <= 3600)
    return { status: "limited", retryAfterSeconds: value.retryAfterSeconds };
  return { status: "unavailable" };
}
