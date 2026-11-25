import type { NextRequest } from "next/server";
import { failure, input, reply } from "../../../../../server/auth/http";
import { requestSession } from "../../../../../server/auth/supabase";
import { parseScreeningSheet } from "../../../../../server/respondent/screening-sheet";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type Context = { params: Promise<{ inviteId: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  if (process.env.ENVOI_GATE2_SCREENING_SHEET_ENABLED !== "true") return failure(404);
  const { inviteId } = await params;
  if (!uuid.test(inviteId)) return failure(404);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const identity = await session.client.auth.getClaims();
  if (identity.error || !identity.data?.claims?.sub) return session.commit(failure(403));
  const { data, error } = await session.client.rpc("read_gate2_screening_sheet", {
    supplied_invite_id: inviteId,
  });
  if (error) return session.commit(failure(503));
  if (data === null) return session.commit(failure(404));
  const sheet = parseScreeningSheet(data);
  return session.commit(sheet && sheet.inviteId === inviteId
    ? reply(200, sheet) : failure(503));
}

export async function POST(request: NextRequest, { params }: Context) {
  if (process.env.ENVOI_GATE2_SCREENING_SHEET_ENABLED !== "true") return failure(404);
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const { inviteId } = await params;
  const { ruleId, ruleVersion, text, key } = parsed.body;
  if (!uuid.test(inviteId) || Object.keys(parsed.body).length !== 4 ||
    typeof ruleId !== "string" || !uuid.test(ruleId) ||
    !Number.isSafeInteger(ruleVersion) || (ruleVersion as number) < 1 ||
    typeof text !== "string" || !text.trim() || text.length > 2000 ||
    typeof key !== "string" || !/^gate2-screen:[a-f0-9-]{36}$/.test(key))
    return failure(400);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const identity = await session.client.auth.getClaims();
  if (identity.error || !identity.data?.claims?.sub) return session.commit(failure(403));
  const { data, error } = await session.client.rpc("submit_gate2_screening_text", {
    supplied_invite_id: inviteId, supplied_rule_id: ruleId,
    supplied_version: ruleVersion as number, supplied_text: text, supplied_key: key,
  });
  if (error) return session.commit(failure(
    error.code === "23514" || error.code === "23505" ? 409 :
      error.code === "42501" ? 403 : 503));
  if (!data || typeof data !== "object" || Array.isArray(data) ||
    data.inviteId !== inviteId || data.ruleId !== ruleId ||
    data.ruleVersion !== ruleVersion || data.status !== "pending_review")
    return session.commit(failure(503));
  return session.commit(reply(200, { status: "pending_review" }));
}
