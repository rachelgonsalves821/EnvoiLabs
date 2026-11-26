import type { SupabaseClient } from "@supabase/supabase-js";
import { issueReservedReferralPayout } from "@envoi-labs/services/payout";
import type { Database } from "../../../../packages/db/src/database.generated";
import { createGate2SandboxReferralPayoutDatabase,
  readGate2SandboxPayoutRecipient } from "./gate2-sandbox-payout-db";
import { createTremendousSandboxPayoutProvider } from "./gate2-tremendous-sandbox";

// Default-off TEST composition. No route or scheduler calls this until the
// recipient, denomination and referral-policy approval gates are settled.
export async function issueGate2SandboxVisaReferral(input: {
  client: SupabaseClient<Database>;
  apiKey: string;
  vestingId: string;
  annualCapCents: number;
  request?: typeof fetch;
}) {
  const database = createGate2SandboxReferralPayoutDatabase(
    input.client, input.annualCapCents);
  const provider = createTremendousSandboxPayoutProvider({
    apiKey: input.apiKey, ...(input.request ? { request: input.request } : {}),
    recipient: (payoutId) => readGate2SandboxPayoutRecipient(input.client, payoutId),
  });
  return issueReservedReferralPayout(database, provider, input.vestingId);
}
