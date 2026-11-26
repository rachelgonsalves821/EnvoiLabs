import type { VoiceTake } from "../../interviews/[inviteId]/use-voice-capture";

type Reservation = { audioObjectId: string; uploadUrl: string;
  expiresAt: string; uploaded: boolean };
export type ScreeningVoiceTransfer = { takeId: string; reservation?: Reservation };
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

export async function submitScreeningVoice(input: {
  inviteId: string; ruleId: string; ruleVersion: number;
  take: VoiceTake; transfer: ScreeningVoiceTransfer; signal: AbortSignal;
}): Promise<number> {
  const { inviteId, ruleId, ruleVersion, take, transfer, signal } = input;
  const endpoint = `/api/respondent/screening/${encodeURIComponent(inviteId)}/audio`;
  if (signal.aborted || transfer.takeId !== take.answerId) return 503;
  if (!transfer.reservation || (!transfer.reservation.uploaded &&
      Date.parse(transfer.reservation.expiresAt) <= Date.now())) {
    const response = await fetch(endpoint, { method: "POST", credentials: "same-origin",
      cache: "no-store", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ruleId, ruleVersion, bytes: take.blob.size, mime: take.mime }), signal });
    if (!response.ok) return response.status;
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return 503;
    const row = data as Record<string, unknown>;
    if (typeof row.audioObjectId !== "string" || !uuid.test(row.audioObjectId) ||
      typeof row.uploadUrl !== "string" || !/^https?:\/\//.test(row.uploadUrl) ||
      typeof row.expiresAt !== "string" || Date.parse(row.expiresAt) <= Date.now()) return 503;
    transfer.reservation = { audioObjectId: row.audioObjectId,
      uploadUrl: row.uploadUrl, expiresAt: row.expiresAt, uploaded: false };
  }
  const reservation = transfer.reservation;
  if (!reservation.uploaded) {
    const uploaded = await fetch(reservation.uploadUrl, { method: "PUT", body: take.blob,
      headers: { "Content-Type": take.mime }, credentials: "omit", referrerPolicy: "no-referrer",
      redirect: "error", signal });
    if (uploaded.status !== 200 && uploaded.status !== 409) return uploaded.status;
    reservation.uploaded = true;
  }
  const confirmed = await fetch(endpoint, { method: "PUT", credentials: "same-origin",
    cache: "no-store", headers: { "content-type": "application/json" },
    body: JSON.stringify({ audioObjectId: reservation.audioObjectId,
      durationMs: take.durationMs }), signal });
  if (!confirmed.ok) return confirmed.status;
  const result: unknown = await confirmed.json();
  return result && typeof result === "object" && !Array.isArray(result) &&
    (result as Record<string, unknown>).status === "queued" ? 200 : 503;
}
