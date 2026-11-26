import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../packages/db/src/database.generated";

const statuses = new Set(["awaiting_reservation", "pending", "ordered", "delivered", "failed"]);
type Earnings = {
  currency: "usd";
  earnedCents: number;
  deliveredCents: number;
  sessions: { sessionId: string; studyId: string; earnedCents: number;
    payoutStatus: "awaiting_reservation" | "pending" | "ordered" | "delivered" | "failed";
    payoutId?: string | null; batchId?: string | null;
    deliveredAt?: string | null }[];
  referral: { verifiedProfiles: number; vestedBonusCents: number };
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const cents = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const uuid = (value: unknown) => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function parseCurrentEarnings(value: unknown): Earnings | null {
  if (!record(value) || value.currency !== "usd" || !cents(value.earnedCents) ||
    !cents(value.deliveredCents) || (value.deliveredCents as number) > (value.earnedCents as number) ||
    !Array.isArray(value.sessions) || !record(value.referral) ||
    !cents(value.referral.verifiedProfiles) || !cents(value.referral.vestedBonusCents)) return null;
  for (const item of value.sessions) {
    if (!record(item) || typeof item.sessionId !== "string" ||
      typeof item.studyId !== "string" || !cents(item.earnedCents) ||
      typeof item.payoutStatus !== "string" || !statuses.has(item.payoutStatus) ||
      ("payoutId" in item && item.payoutId !== null && !uuid(item.payoutId)) ||
      ("batchId" in item && item.batchId !== null && !uuid(item.batchId)) ||
      (item.batchId !== undefined && item.batchId !== null && !uuid(item.payoutId)) ||
      ("deliveredAt" in item && item.deliveredAt !== null &&
        (typeof item.deliveredAt !== "string" ||
          !Number.isFinite(Date.parse(item.deliveredAt))))) return null;
  }
  return value as Earnings;
}

export async function readCurrentEarnings(client: SupabaseClient<Database>): Promise<Earnings | null> {
  const { data, error } = await client.rpc("read_gate2_current_respondent_earnings");
  return error ? null : parseCurrentEarnings(data);
}
