import type { NextRequest } from "next/server";
import { failure, reply } from "../../../../server/auth/http";
import { requestSession } from "../../../../server/auth/supabase";

export async function GET(request: NextRequest) {
  if (process.env.ENVOI_GATE2_EARNINGS_ENABLED !== "true") return failure(404);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const identity = await session.client.auth.getClaims();
  if (identity.error || !identity.data?.claims?.sub)
    return session.commit(failure(403));
  const { data, error } = await session.client.rpc("read_gate2_current_respondent_earnings");
  if (error) return session.commit(failure(503));
  return session.commit(data === null ? failure(404) : reply(200, data));
}
