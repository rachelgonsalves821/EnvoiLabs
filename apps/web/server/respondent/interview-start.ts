import {
  SessionResponseSchema, StartSessionRequestSchema, UpdateInviteRequestSchema, UpdateInviteResponseSchema,
} from "@envoi-labs/contracts";
import type { NextRequest } from "next/server";
import { failure, input, reply } from "../auth/http";
import { requestSession } from "../auth/supabase";

function mutationFailure(error: { code: string } | null) {
  if (error?.code === "42501") return failure(404);
  if (error?.code === "23514") return failure(409);
  return failure(503);
}

export async function updateInvite(request: NextRequest, action: "accept" | "decline") {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const choice = UpdateInviteRequestSchema.safeParse(parsed.body);
  if (!choice.success || choice.data.action !== action) return failure(400);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const identity = await session.client.auth.getClaims();
  if (identity.error || !identity.data?.claims.sub) return failure(401);
  const { data, error } = await session.client.rpc("update_gate1_invite", {
    supplied_invite_id: choice.data.inviteId, supplied_action: action,
  });
  const result = UpdateInviteResponseSchema.safeParse(data);
  if (error || !result.success) return mutationFailure(error);
  return session.commit(reply(200, result.data));
}

export async function startInterview(request: NextRequest) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const selection = StartSessionRequestSchema.safeParse(parsed.body);
  if (!selection.success) return failure(400);
  const session = requestSession(request);
  if (!session.client) return failure(503);
  const identity = await session.client.auth.getClaims();
  if (identity.error || !identity.data?.claims.sub) return failure(401);
  const { data, error } = await session.client.rpc("start_gate1_session", { supplied_invite_id: selection.data.inviteId });
  const result = SessionResponseSchema.safeParse(data);
  if (error || !result.success) return mutationFailure(error);
  return session.commit(reply(200, result.data));
}
