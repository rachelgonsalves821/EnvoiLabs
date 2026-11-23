import type { NextRequest } from "next/server";
import { failure, reply } from "../../../../../../server/auth/http";
import { requestSession } from "../../../../../../server/auth/supabase";
import { readResearcherTranscripts } from "../../../../../../server/researcher/study-transcripts";

export async function GET(request: NextRequest, { params }: { params: Promise<{ studyId: string }> }) {
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const claims = await session.client.auth.getClaims();
  if (claims.error || claims.data?.claims?.aal !== "aal2") return session.commit(failure(403));
  const { studyId } = await params;
  const grouped = request.nextUrl.searchParams.get("version") === "2";
  const result = await readResearcherTranscripts(session.client, studyId, grouped);
  return session.commit(result.status === 200 ? reply(200, result.transcripts) : failure(result.status));
}
