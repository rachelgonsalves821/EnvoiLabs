import type { NextRequest } from "next/server";
import { failure, reply } from "../../../../../../server/auth/http";
import { requestSession } from "../../../../../../server/auth/supabase";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export async function GET(request: NextRequest,
  { params }: { params: Promise<{ studyId: string }> }) {
  if (process.env.ENVOI_GATE2_TEST_CHECKOUT_ENABLED !== "true") return failure(404);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const identity = await session.client.auth.getClaims();
  if (identity.error || identity.data?.claims?.aal !== "aal2" ||
    !identity.data.claims.sub) return session.commit(failure(403));
  const { studyId } = await params;
  if (!uuid.test(studyId)) return session.commit(failure(404));
  const { data, error } = await session.client.rpc("read_gate2_current_researcher_receipt", {
    supplied_study_id: studyId,
  });
  if (error) return session.commit(failure(503));
  return session.commit(data === null ? failure(404) : reply(200, data));
}
