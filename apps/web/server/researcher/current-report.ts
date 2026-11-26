import { StudyTrackingRequestSchema } from "@envoi-labs/contracts";
import { loadCurrentQualifiedReport } from "@envoi-labs/services/reviewed-report-adapter";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../packages/db/src/database.generated";

// Use only the request's authenticated client. The security-invoker RPC reads
// the newest report and its current qualified evidence in one DB statement.
export async function readCurrentResearcherReport(
  client: SupabaseClient<Database>, studyId: string) {
  const parsed = StudyTrackingRequestSchema.safeParse({ studyId });
  if (!parsed.success) return { status: 404 } as const;
  try {
    const report = await loadCurrentQualifiedReport(client, parsed.data.studyId);
    return report ? { status: 200, report } as const : { status: 404 } as const;
  } catch (error) {
    return { status: (error as { code?: string })?.code === "42501" ? 403 : 503 } as const;
  }
}
