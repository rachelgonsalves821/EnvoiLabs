import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../packages/db/src/database.generated";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export type ApprovedCompleteSnapshot = {
  studyId: string;
  quoteId: string;
  targetRespondents: number;
  approvedCompleteCount: number;
  sessionIds: readonly string[];
};

/** Service-only study snapshot; a null result means no authorized paid quote. */
export async function readGate2ApprovedCompleteSnapshot(
  client: SupabaseClient<Database>, studyId: string, quoteId: string,
  authUserId: string): Promise<ApprovedCompleteSnapshot | null> {
  if (![studyId, quoteId, authUserId].every((id) => uuid.test(id)))
    throw new Error("Invalid approved-complete lookup identity");
  const { data, error } = await client.rpc(
    "read_gate2_approved_complete_snapshot", {
      supplied_study_id: studyId, supplied_quote_id: quoteId,
      supplied_auth_user_id: authUserId,
    });
  if (error) throw error;
  if (data === null) return null;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Invalid approved-complete snapshot");
  const row = data as Record<string, unknown>;
  const ids = row.sessionIds;
  if (row.studyId !== studyId || row.quoteId !== quoteId ||
      !Number.isSafeInteger(row.targetRespondents) ||
      (row.targetRespondents as number) < 10 ||
      !Number.isSafeInteger(row.approvedCompleteCount) ||
      (row.approvedCompleteCount as number) < 0 ||
      (row.approvedCompleteCount as number) > (row.targetRespondents as number) ||
      !Array.isArray(ids) || ids.length !== row.approvedCompleteCount ||
      !ids.every((id) => typeof id === "string" && uuid.test(id)) ||
      new Set(ids).size !== ids.length)
    throw new Error("Invalid approved-complete snapshot");
  return {
    studyId, quoteId, targetRespondents: row.targetRespondents as number,
    approvedCompleteCount: row.approvedCompleteCount as number,
    sessionIds: ids as string[],
  };
}
