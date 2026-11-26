import type { NextRequest } from "next/server";
import { failure, reply } from "../../../../../../server/auth/http";
import { requestSession } from "../../../../../../server/auth/supabase";
import { readCurrentResearcherReport } from
  "../../../../../../server/researcher/current-report";

export async function GET(request: NextRequest,
  { params }: { params: Promise<{ studyId: string }> }) {
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const claims = await session.client.auth.getClaims();
  if (claims.error || claims.data?.claims?.aal !== "aal2")
    return session.commit(failure(403));
  const { studyId } = await params;
  const result = await readCurrentResearcherReport(session.client, studyId);
  return session.commit(result.status === 200
    ? reply(200, result.report) : failure(result.status));
}
