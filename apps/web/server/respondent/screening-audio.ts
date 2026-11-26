import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { failure, input, reply } from "../auth/http";
import { requestSession, trustedClient } from "../auth/supabase";
import { baseAudioMime, matchesAudioContainer, maxAudioBytes } from "./private-audio";

export const screeningAudioBucket = "gate2-screening-audio";
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const errorResponse = (code?: string) => failure(code === "42501" ? 404 :
  code === "23514" || code === "23505" ? 409 : 503);

export async function reserveScreeningAudio(request: NextRequest, inviteId: string) {
  if (process.env.ENVOI_GATE2_SCREENING_VOICE_ENABLED !== "true") return failure(404);
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const { ruleId, ruleVersion, bytes, mime } = parsed.body;
  const audioMime = baseAudioMime(mime);
  if (!uuid.test(inviteId) || Object.keys(parsed.body).length !== 4 ||
    typeof ruleId !== "string" || !uuid.test(ruleId) ||
    !Number.isSafeInteger(ruleVersion) || (ruleVersion as number) < 1 ||
    !Number.isSafeInteger(bytes) || (bytes as number) < 1 ||
    (bytes as number) > maxAudioBytes || typeof mime !== "string" || !audioMime)
    return failure(400);
  const session = requestSession(request);
  const service = trustedClient();
  if (!session.client || !service) return failure(503);
  const identity = await session.client.auth.getClaims();
  if (identity.error || !identity.data?.claims?.sub) return session.commit(failure(403));
  const { data, error } = await session.client.rpc("reserve_gate2_screening_audio", {
    supplied_invite_id: inviteId, supplied_rule_id: ruleId,
    supplied_version: ruleVersion as number, supplied_bytes: bytes as number,
    supplied_mime: audioMime,
  });
  if (error) return session.commit(errorResponse(error.code));
  if (!data || typeof data.audioObjectId !== "string" || !uuid.test(data.audioObjectId))
    return session.commit(failure(503));
  const signed = await service.storage.from(screeningAudioBucket).createSignedUploadUrl(
    `screening/${inviteId}/${data.audioObjectId}`, { upsert: false },
  );
  if (signed.error || typeof signed.data?.signedUrl !== "string")
    return session.commit(failure(503));
  return session.commit(reply(200, {
    audioObjectId: data.audioObjectId, expiresAt: data.expiresAt,
    uploadUrl: signed.data.signedUrl,
  }));
}

export async function confirmScreeningAudio(request: NextRequest, inviteId: string) {
  if (process.env.ENVOI_GATE2_SCREENING_VOICE_ENABLED !== "true") return failure(404);
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const { audioObjectId, durationMs } = parsed.body;
  if (!uuid.test(inviteId) || Object.keys(parsed.body).length !== 2 ||
    typeof audioObjectId !== "string" || !uuid.test(audioObjectId) ||
    !Number.isSafeInteger(durationMs) || (durationMs as number) < 1 ||
    (durationMs as number) > 180_000) return failure(400);
  const session = requestSession(request);
  const service = trustedClient();
  if (!session.client || !service) return failure(503);
  const identity = await session.client.auth.getClaims();
  if (identity.error || !identity.data?.claims?.sub) return session.commit(failure(403));
  const reservation = await session.client.rpc("read_gate2_screening_audio_reservation", {
    supplied_invite_id: inviteId, supplied_audio_id: audioObjectId,
  });
  if (reservation.error) return session.commit(errorResponse(reservation.error.code));
  const { ownerId, bytes: expectedBytes, mime } = reservation.data ?? {};
  const audioMime = baseAudioMime(mime);
  if (typeof ownerId !== "string" || !uuid.test(ownerId) ||
    !Number.isSafeInteger(expectedBytes) || expectedBytes < 1 ||
    expectedBytes > maxAudioBytes || !audioMime) return session.commit(failure(503));
  const stored = await service.storage.from(screeningAudioBucket).download(
    `screening/${inviteId}/${audioObjectId}`,
  );
  if (stored.error || !stored.data || stored.data.size !== expectedBytes ||
    baseAudioMime(stored.data.type) !== audioMime) return session.commit(failure(409));
  const content = Buffer.from(await stored.data.arrayBuffer());
  if (!matchesAudioContainer(content, audioMime)) return session.commit(failure(409));
  const sha256 = createHash("sha256").update(content).digest("hex");
  const confirmed = await service.rpc("confirm_gate2_screening_audio", {
    supplied_owner_id: ownerId, supplied_invite_id: inviteId,
    supplied_audio_id: audioObjectId, supplied_duration_ms: durationMs as number,
    supplied_sha256: sha256,
  });
  if (confirmed.error) return session.commit(errorResponse(confirmed.error.code));
  return session.commit(confirmed.data?.audioObjectId === audioObjectId &&
    confirmed.data?.status === "queued" ? reply(200, { status: "queued" }) : failure(503));
}
