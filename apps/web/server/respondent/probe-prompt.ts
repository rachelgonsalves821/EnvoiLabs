import {
  MarkProbeShownRequestSchema, RecordAnswerResponseSchema,
  RecordProbeRenderErrorRequestSchema, RecordProbeTextAnswerRequestSchema,
} from "@envoi-labs/contracts";
import type { NextRequest } from "next/server";
import { failure, input, reply } from "../auth/http";
import { requestSession, trustedClient } from "../auth/supabase";

async function respondent(request: NextRequest) {
  const session = requestSession(request);
  if (!session.client) return null;
  const identity = await session.client.auth.getClaims();
  if (identity.error || !identity.data?.claims.sub) return null;
  return { session, authUserId: identity.data.claims.sub };
}

export async function markProbeShown(request: NextRequest) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const choice = MarkProbeShownRequestSchema.safeParse(parsed.body);
  if (!choice.success) return failure(400);
  const actor = await respondent(request);
  if (!actor) return failure(401);
  const trusted = trustedClient();
  if (!trusted) return failure(503);
  const { data, error } = await trusted.rpc("mark_gate3_probe_shown", {
    supplied_session_id: choice.data.sessionId,
    supplied_turn_id: choice.data.turnId,
    supplied_probe_id: choice.data.probeId,
    supplied_auth_user_id: actor.authUserId,
    supplied_browser_rendered_ms: choice.data.browserRenderedAtMs,
  });
  if (error) return failure(503);
  if (data !== "recorded") return failure(409);
  return actor.session.commit(reply(200, { status: "recorded" }));
}

export async function recordProbeRenderError(request: NextRequest) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const choice = RecordProbeRenderErrorRequestSchema.safeParse(parsed.body);
  if (!choice.success) return failure(400);
  const actor = await respondent(request);
  if (!actor) return failure(401);
  const trusted = trustedClient();
  if (!trusted) return failure(503);
  const { data, error } = await trusted.rpc("record_gate3_probe_render_error", {
    supplied_session_id: choice.data.sessionId,
    supplied_turn_id: choice.data.turnId,
    supplied_probe_id: choice.data.probeId,
    supplied_auth_user_id: actor.authUserId,
  });
  if (error) return failure(503);
  if (!data || typeof data !== "object" || data.status !== "resolved"
    || data.turnId !== choice.data.turnId || ![
      "shown", "error", "timeout", "superseded",
    ].includes(data.outcome)) return failure(409);
  return actor.session.commit(reply(200, { status: "resolved", outcome: data.outcome }));
}

export async function recordProbeTextAnswer(request: NextRequest) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const answer = RecordProbeTextAnswerRequestSchema.safeParse(parsed.body);
  if (!answer.success) return failure(400);
  const actor = await respondent(request);
  if (!actor) return failure(401);
  const trusted = trustedClient();
  if (!trusted) return failure(503);
  const { data, error } = await trusted.rpc("record_gate3_probe_text_answer", {
    supplied_session_id: answer.data.sessionId,
    supplied_turn_id: answer.data.turnId,
    supplied_probe_id: answer.data.probeId,
    supplied_answer_id: answer.data.answerId,
    supplied_auth_user_id: actor.authUserId,
    supplied_text: answer.data.text,
  });
  if (error) return failure(error.code === "42501" ? 404 : error.code === "23505" ? 409 : 503);
  const result = RecordAnswerResponseSchema.safeParse(data);
  if (!result.success || result.data.answer.id !== answer.data.answerId
    || result.data.answer.probeId !== answer.data.probeId) return failure(503);
  return actor.session.commit(reply(200, result.data));
}
