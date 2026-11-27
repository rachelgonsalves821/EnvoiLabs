import { RecordAnswerResponseSchema, StartAudioUploadResponseSchema } from "@envoi-labs/contracts";
import { interviewRequest } from "../../interview-request";
import { browserProbeClockStamp } from "./browser-probe-clock";
import type { VoiceTake } from "./use-voice-capture";

type UploadReservation = {
  audioObjectId: string;
  uploadUrl: string;
  expiresAt: string;
  uploaded: boolean;
  uploadClock?: ReturnType<typeof browserProbeClockStamp>;
};

// Keep the same uploaded object and answer ID when only final confirmation needs retrying.
export type VoiceTransfer = { answerId: string; reservation?: UploadReservation };

async function putAudio(url: string, blob: Blob, signal: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const cancel = () => controller.abort();
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel);
  try {
    const response = await fetch(url, {
      method: "PUT", headers: { "Content-Type": blob.type }, body: blob,
      credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: controller.signal,
    });
    if (response.ok) return 200;
    if (response.status === 400) {
      const error: unknown = await response.json().catch(() => null);
      if (error && typeof error === "object" && "message" in error
        && error.message === "The resource already exists") return 409;
    }
    return response.status;
  } catch {
    return 503;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}

type VoiceTransferInput = {
  take: VoiceTake;
  transfer: VoiceTransfer;
  scope: { sessionId: string; guideQuestionId: string };
  signal: AbortSignal;
};

async function stage({ take, transfer, scope, signal }: VoiceTransferInput) {
  if (!transfer.reservation || (!transfer.reservation.uploaded && Date.parse(transfer.reservation.expiresAt) <= Date.now())) {
    const response = await interviewRequest("/api/respondent/answers/upload", {
      ...scope, bytes: take.blob.size, mime: take.mime,
    }, signal);
    if (response.status >= 400) return response.status;
    const reserved = StartAudioUploadResponseSchema.safeParse(response.data);
    if (!reserved.success || Date.parse(reserved.data.expiresAt) <= Date.now()) return 503;
    transfer.reservation = { ...reserved.data, uploaded: false };
  }
  if (signal.aborted) return 503;
  const reservation = transfer.reservation;
  if (!reservation.uploaded) {
    const status = await putAudio(reservation.uploadUrl, take.blob, signal);
    // An earlier PUT can succeed even if its acknowledgement was lost. In that case
    // storage may reject the retry. The confirm endpoint checks the reserved object's metadata.
    if (status !== 200 && status !== 409) return status;
    if (status === 200 && process.env.NEXT_PUBLIC_ENVOI_GATE3_PROBE_CLOCK_ENABLED === "true")
      reservation.uploadClock = browserProbeClockStamp();
    reservation.uploaded = true;
  }
  return 200;
}

async function confirm({ take, transfer, scope, signal }: VoiceTransferInput) {
  const reservation = transfer.reservation;
  if (!reservation?.uploaded || signal.aborted) return 503;
  const response = await interviewRequest("/api/respondent/answers/record", {
    ...scope, kind: "voice", answerId: take.answerId,
    audioObjectId: reservation.audioObjectId, durationMs: take.durationMs,
  }, signal);
  if (response.status >= 400) return response.status;
  const recorded = RecordAnswerResponseSchema.safeParse(response.data);
  const valid = recorded.success && recorded.data.answer.id === take.answerId &&
    recorded.data.answer.kind === "voice" && recorded.data.answer.sessionId === scope.sessionId &&
    recorded.data.answer.guideQuestionId === scope.guideQuestionId;
  if (!valid) return 503;
  if (reservation.uploadClock) await interviewRequest("/api/respondent/probes/upload-clock", {
    answerId: take.answerId, browserClockOriginId: reservation.uploadClock.browserClockOriginId,
    browserUploadConfirmedAtMs: reservation.uploadClock.atMs, browserUploadKind: "voice_object_put",
  }, signal);
  return 200;
}

async function withRetry(input: VoiceTransferInput, action: (input: VoiceTransferInput) => Promise<number>) {
  for (const delay of [0, 300, 900]) {
    if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    if (input.signal.aborted) return 503;
    const status = await action(input);
    if (status < 500) return status;
  }
  return 503;
}

export function stageVoiceTake(input: VoiceTransferInput) {
  return withRetry(input, stage);
}

export function confirmVoiceTake(input: VoiceTransferInput) {
  return withRetry(input, confirm);
}
