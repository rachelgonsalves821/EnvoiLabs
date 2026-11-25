import type { NextRequest } from "next/server";
import { failure, input, reply } from "../../../../../../server/auth/http";
import { requestSession, trustedClient } from "../../../../../../server/auth/supabase";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type Review = { quoteId: string; sessionId: string; decision: "approve" | "remove";
  score: number; components: Record<string, number>; reason: string | null };

function parseReview(body: Record<string, unknown>): Review | null {
  if (Object.keys(body).some((key) => !["quoteId", "sessionId", "decision",
    "score", "components", "reason"].includes(key)) ||
    typeof body.quoteId !== "string" || !uuid.test(body.quoteId) ||
    typeof body.sessionId !== "string" || !uuid.test(body.sessionId) ||
    (body.decision !== "approve" && body.decision !== "remove") ||
    !Number.isInteger(body.score) || (body.score as number) < 0 ||
    (body.score as number) > 100 || !body.components ||
    typeof body.components !== "object" || Array.isArray(body.components)) return null;
  const components = body.components as Record<string, unknown>;
  const entries = Object.entries(components);
  if (entries.length < 1 || entries.length > 10 || entries.some(([key, value]) =>
    !/^[a-z][a-z0-9_]{0,39}$/.test(key) || !Number.isInteger(value) ||
    (value as number) < 0 || (value as number) > 100)) return null;
  const reason = body.decision === "remove" ? body.reason : null;
  if (body.decision === "remove" && (typeof reason !== "string" ||
    reason.trim().length < 20 || reason.length > 500)) return null;
  if (body.decision === "approve" && body.reason !== undefined && body.reason !== null)
    return null;
  return { quoteId: body.quoteId, sessionId: body.sessionId,
    decision: body.decision, score: body.score as number,
    components: components as Record<string, number>, reason: reason as string | null };
}

export async function POST(request: NextRequest,
  { params }: { params: Promise<{ studyId: string }> }) {
  if (process.env.ENVOI_GATE2_QUALITY_REVIEW_ENABLED !== "true") return failure(404);
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const review = parseReview(parsed.body);
  if (!review) return failure(400);
  const { studyId } = await params;
  if (!uuid.test(studyId)) return failure(404);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const identity = await session.client.auth.getClaims();
  const authUserId = identity.data?.claims?.sub;
  if (identity.error || identity.data?.claims?.aal !== "aal2" || !authUserId)
    return session.commit(failure(403));
  const { data: researcher, error } = await session.client.from("researchers")
    .select("id,organization_id").eq("auth_user_id", authUserId).maybeSingle();
  if (error) return session.commit(failure(503));
  if (!researcher) return session.commit(failure(403));
  const { data: study, error: studyError } = await session.client.from("studies")
    .select("id").eq("id", studyId)
    .eq("organization_id", researcher.organization_id).maybeSingle();
  if (studyError) return session.commit(failure(503));
  if (!study) return session.commit(failure(404));
  const trusted = trustedClient();
  if (!trusted) return session.commit(failure(503));
  const { data, error: decisionError } = await trusted.rpc("decide_gate2_marketplace_quality", {
    supplied_study_id: studyId, supplied_quote_id: review.quoteId,
    supplied_session_id: review.sessionId, supplied_actor_auth_id: authUserId,
    supplied_decision: review.decision, supplied_score: review.score,
    supplied_components: review.components, supplied_reason: review.reason,
  });
  if (decisionError) return session.commit(failure(
    decisionError.code === "23514" || decisionError.code === "42501" ? 409 : 503));
  if (!data || typeof data !== "object" || Array.isArray(data) ||
    data.sessionId !== review.sessionId || data.decision !== review.decision)
    return session.commit(failure(503));
  const replacement = data.replacement;
  const replacementCreated = replacement === null ? 0 :
    replacement && typeof replacement === "object" && !Array.isArray(replacement)
      ? replacement.created : null;
  if (!Number.isSafeInteger(replacementCreated) ||
    (replacementCreated as number) < 0 || (replacementCreated as number) > 1)
    return session.commit(failure(503));
  return session.commit(reply(200, { sessionId: review.sessionId,
    decision: review.decision, replacementCreated }));
}
