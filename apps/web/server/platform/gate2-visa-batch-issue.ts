import type { SupabaseClient } from "@supabase/supabase-js";
import { issueReservedBatchPayout } from "@envoi-labs/services/payout";
import type { Database } from "../../../../packages/db/src/database.generated";
import { createGate2SandboxBatchPayoutDatabase,
  readGate2SandboxPayoutRecipient } from "./gate2-sandbox-payout-db";
import { createTremendousSandboxPayoutProvider } from "./gate2-tremendous-sandbox";

// No route or scheduler calls this yet. The TEST_-only provider and immutable
// synthetic route are explicit until real payout verification is approved.
export async function issueGate2SandboxVisaBatch(input: {
  client: SupabaseClient<Database>;
  apiKey: string;
  respondentId: string;
  requestId: string;
  annualCapCents: number;
  request?: typeof fetch;
  fictionalProvider?: boolean;
  fictionalIssuerClient?: SupabaseClient<Database>;
}) {
  if (input.fictionalProvider && !input.request)
    throw new Error("Fictional provider requires an injected request");
  if (input.fictionalProvider && !input.fictionalIssuerClient)
    throw new Error("Fictional provider requires a separate issuer client");
  const database = createGate2SandboxBatchPayoutDatabase(
    input.client, input.annualCapCents, input.fictionalProvider === true,
    input.fictionalIssuerClient);
  const provider = createTremendousSandboxPayoutProvider({
    apiKey: input.apiKey, ...(input.request ? { request: input.request } : {}),
    recipient: (payoutId) => readGate2SandboxPayoutRecipient(input.client, payoutId),
  });
  return issueReservedBatchPayout(database, provider,
    input.respondentId, input.requestId);
}
