import { createHash } from "node:crypto";
import {
  RecordAnswerResponseSchema, StartAudioUploadRequestSchema, StartAudioUploadResponseSchema, type RecordAnswerRequest,
} from "@envoi-labs/contracts";
import type { NextRequest } from "next/server";
import { failure, input, reply } from "../auth/http";
import { requestSession, trustedClient } from "../auth/supabase";
import { gate4RouteCheck, type Gate4RouteCheck } from "../gate4/route-check";
import { rateLimitRejection } from "../gate4/rate-limit-http";

export const audioBucket = "gate1-interview-audio";
export const maxAudioBytes = 20 * 1024 * 1024;
const supported = ["audio/webm", "audio/mp4", "audio/wav", "audio/ogg"] as const;
type AudioMime = typeof supported[number];
type Client = NonNullable<ReturnType<typeof requestSession>["client"]>;
type VoiceAnswer = Extract<RecordAnswerRequest, { kind: "voice" }>;
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export function baseAudioMime(value: unknown): AudioMime | undefined {
  if (typeof value !== "string") return undefined;
  return supported.find((kind) => kind === value.split(";")[0]?.trim().toLowerCase());
}

export function matchesAudioContainer(bytes: Buffer, mime: AudioMime) {
  switch (mime) {
    case "audio/webm": return bytes.subarray(0, 4).toString("hex") === "1a45dfa3";
    case "audio/mp4": return bytes.toString("ascii", 4, 8) === "ftyp";
    case "audio/wav": return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
    case "audio/ogg": return bytes.toString("ascii", 0, 4) === "OggS";
  }
}

function audioFailure(error: { code: string } | null) {
  if (error?.code === "42501") return failure(404);
  if (["23514", "23505"].includes(error?.code ?? "")) return failure(409);
  return failure(503);
}

export async function startAudioUpload(request: NextRequest, check: Gate4RouteCheck = gate4RouteCheck) {
  const parsed = await input(request);
  if (parsed.error !== undefined) return failure(parsed.error);
  const audio = StartAudioUploadRequestSchema.safeParse(parsed.body);
  if (!audio.success || audio.data.bytes > maxAudioBytes) return failure(400);
  const mime = baseAudioMime(audio.data.mime);
  if (!mime) return failure(400);

  const session = requestSession(request);
  const service = trustedClient();
  if (!session.client || !service) return failure(503);
  const identity = await session.client.auth.getClaims();
  if (identity.error || !identity.data?.claims.sub) return failure(401);
  const rejection = rateLimitRejection(await check(request, "audio-upload", identity.data.claims.sub));
  if (rejection) return rejection;
  const { data, error } = await session.client.rpc("reserve_gate1_audio", {
    supplied_session_id: audio.data.sessionId, supplied_question_id: audio.data.guideQuestionId,
    supplied_bytes: audio.data.bytes, supplied_mime: mime,
  });
  if (error) return audioFailure(error);
  if (typeof data?.audioObjectId !== "string" || !uuid.test(data.audioObjectId)) return failure(503);
  const signed = await service.storage.from(audioBucket).createSignedUploadUrl(
    `${audio.data.sessionId}/${data.audioObjectId}`, { upsert: false },
  );
  const upload = StartAudioUploadResponseSchema.safeParse({ ...data, uploadUrl: signed.data?.signedUrl });
  if (signed.error || !upload.success) return failure(503);
  return session.commit(reply(200, upload.data));
}

export async function confirmVoiceAnswer(client: Client, answer: VoiceAnswer) {
  if (answer.durationMs > 180_000) return failure(400);
  const service = trustedClient();
  if (!service) return failure(503);
  const reservation = await client.rpc("read_gate1_audio_reservation", {
    supplied_session_id: answer.sessionId, supplied_question_id: answer.guideQuestionId,
    supplied_audio_id: answer.audioObjectId,
  });
  if (reservation.error) return audioFailure(reservation.error);
  const size = reservation.data?.bytes;
  const owner = reservation.data?.ownerId;
  const mime = baseAudioMime(reservation.data?.mime);
  if (typeof size !== "number" || size <= 0 || size > maxAudioBytes || typeof owner !== "string" ||
      !uuid.test(owner) || !mime) return failure(503);
  const file = await service.storage.from(audioBucket).download(`${answer.sessionId}/${answer.audioObjectId}`);
  if (file.error || !file.data || file.data.size !== size || baseAudioMime(file.data.type) !== mime) {
    return failure(409);
  }
  const bytes = Buffer.from(await file.data.arrayBuffer());
  if (!matchesAudioContainer(bytes, mime)) return failure(409);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const { data, error } = await service.rpc("confirm_gate1_voice_answer", {
    supplied_owner_id: owner, supplied_session_id: answer.sessionId, supplied_question_id: answer.guideQuestionId,
    supplied_audio_id: answer.audioObjectId, supplied_answer_id: answer.answerId,
    supplied_duration_ms: answer.durationMs, supplied_sha256: "\\x" + sha,
    ...(answer.replaceAnswerId ? { supplied_replace_answer_id: answer.replaceAnswerId } : {}),
  });
  const outcome = RecordAnswerResponseSchema.safeParse(data);
  if (error || !outcome.success) return audioFailure(error);
  return reply(200, outcome.data);
}
