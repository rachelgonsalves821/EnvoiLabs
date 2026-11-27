import type { NextRequest } from "next/server";
import { StudyTrackingRequestSchema } from "@envoi-labs/contracts";
import { loadCurrentQualifiedReport } from "@envoi-labs/services/reviewed-report-adapter";
import { failure, reply } from "../../../../../../server/auth/http";
import { requestSession } from "../../../../../../server/auth/supabase";

export async function GET(request: NextRequest,
  { params }: { params: Promise<{ studyId: string }> }) {
  const session = requestSession(request);
  if (!session.client) return failure(503);
  try {
    const claims = await session.client.auth.getClaims();
    const subject = claims.data?.claims?.sub;
    if (claims.error || claims.data?.claims?.aal !== "aal2" || !subject)
      return session.commit(failure(403));
    const parsed = StudyTrackingRequestSchema.safeParse(await params);
    if (!parsed.success) return session.commit(failure(404));

    const { data: researcher, error: researcherError } = await session.client
      .from("researchers").select("organization_id").eq("auth_user_id", subject).maybeSingle();
    if (researcherError) return session.commit(failure(503));
    if (!researcher) return session.commit(failure(403));
    const { data: study, error: studyError } = await session.client
      .from("studies").select("id").eq("id", parsed.data.studyId)
      .eq("organization_id", researcher.organization_id).maybeSingle();
    if (studyError) return session.commit(failure(503));
    if (!study) return session.commit(failure(403));

    const report = await loadCurrentQualifiedReport(session.client, parsed.data.studyId);
    return session.commit(report ? reply(200, report) : failure(404));
  } catch { return session.commit(failure(503)); }
}
