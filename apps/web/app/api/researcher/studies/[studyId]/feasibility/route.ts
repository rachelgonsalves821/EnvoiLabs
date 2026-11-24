import { readMarketplaceFeasibility } from "@envoi-labs/services/marketplace-feasibility";
import type { NextRequest } from "next/server";
import { failure, reply } from "../../../../../../server/auth/http";
import { requestSession, trustedClient } from "../../../../../../server/auth/supabase";

export async function GET(request: NextRequest,
  { params }: { params: Promise<{ studyId: string }> }) {
  if (process.env.ENVOI_MARKETPLACE_FEASIBILITY_ENABLED !== "true") return failure(404);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const identity = await session.client.auth.getClaims();
  if (identity.error || identity.data?.claims?.aal !== "aal2" ||
    !identity.data.claims.sub) return session.commit(failure(403));
  const trusted = trustedClient();
  if (!trusted) return session.commit(failure(503));
  const { studyId } = await params;
  const result = await readMarketplaceFeasibility(
    (name, args) => trusted.rpc(name, args), studyId, identity.data.claims.sub);
  return session.commit(result.status === 200
    ? reply(200, result.feasibility) : failure(result.status));
}
