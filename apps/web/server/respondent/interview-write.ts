import {
  RecordAnswerRequestSchema, RecordAnswerResponseSchema, SubmitSessionRequestSchema, SubmitSessionResponseSchema,
} from "@envoi-labs/contracts";
import type { NextRequest } from "next/server";
import { failure, input, reply } from "../auth/http";
import { requestSession } from "../auth/supabase";
import { confirmVoiceAnswer } from "./private-audio";

function writeFailure(error: { code: string } | null) {
  if (error?.code === "42501") return failure(404);
  if (error?.code === "23514" || error?.code === "23505") return failure(409);
  return failure(503);
}

export async function recordAnswer(request: NextRequest) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const answer = RecordAnswerRequestSchema.safeParse(parsed.body);
  if (!answer.success) return failure(400);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const identity = await session.client.auth.getClaims();
  if (identity.error || !identity.data?.claims.sub) return failure(401);
  if (answer.data.kind === "voice") return session.commit(await confirmVoiceAnswer(session.client, answer.data));
  const { data, error } = await session.client.rpc("record_gate1_text_answer", {
    supplied_session_id: answer.data.sessionId,
    supplied_question_id: answer.data.guideQuestionId,
    supplied_answer_id: answer.data.answerId,
    supplied_text: answer.data.text,
    ...(answer.data.replaceAnswerId ? { supplied_replace_answer_id: answer.data.replaceAnswerId } : {}),
  });
  const result = RecordAnswerResponseSchema.safeParse(data);
  if (error || !result.success) return writeFailure(error);
  return session.commit(reply(200, result.data));
}

export async function submitInterview(request: NextRequest) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const selection = SubmitSessionRequestSchema.safeParse(parsed.body);
  if (!selection.success) return failure(400);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const identity = await session.client.auth.getClaims();
  if (identity.error || !identity.data?.claims.sub) return failure(401);
  const { data, error } = await session.client.rpc("submit_gate1_session", {
    supplied_session_id: selection.data.sessionId,
  });
  const result = SubmitSessionResponseSchema.safeParse(data);
  if (error || !result.success) return writeFailure(error);
  return session.commit(reply(200, result.data));
}
