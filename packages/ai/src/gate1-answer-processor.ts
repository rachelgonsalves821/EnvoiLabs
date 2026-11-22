import type { Transcriber, Transcription } from "./index.js";

type Lease = { answerId: string; leaseId: string };
type Recording = { storagePath: string; mime: string; bytes: number; sha256: string };
export type AnswerClaim = Lease & (
  { kind: "text"; rawText: string } |
  { kind: "voice"; audio: Recording }
);
type PendingResult = { transcription: Transcription | null; redactedText: string | null };
type Completion = "published" | "private" | "stale" | "alreadyCompleted";

export interface Gate1ProcessingPorts {
  claim(): Promise<AnswerClaim | null>;
  validate(lease: Lease): Promise<boolean>;
  readRecording(storagePath: string): Promise<Uint8Array<ArrayBuffer>>;
  transcriber: Transcriber | null;
  redact: ((text: string) => Promise<string | null>) | null;
  complete(lease: Lease, result: PendingResult): Promise<Completion>;
  retry(lease: Lease): Promise<void>;
}

async function matchesRecording(bytes: Uint8Array<ArrayBuffer>, audio: Recording) {
  if (bytes.length === 0 || bytes.length !== audio.bytes) return false;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("") === audio.sha256;
}

export async function runGate1AnswerJob(ports: Gate1ProcessingPorts): Promise<Completion | "idle" | "retry"> {
  const claim = await ports.claim();
  if (!claim) return "idle";
  const lease = { answerId: claim.answerId, leaseId: claim.leaseId };
  if (!await ports.validate(lease)) return "stale";

  let transcription: Transcription | null = null;
  let rawText: string;
  if (claim.kind === "text") {
    rawText = claim.rawText;
  } else {
    const transcriber = ports.transcriber;
    try {
      if (transcriber) {
        const audio = await ports.readRecording(claim.audio.storagePath);
        if (await matchesRecording(audio, claim.audio)) {
          if (!await ports.validate(lease)) return "stale";
          transcription = await transcriber.transcribe({ audio, mediaType: claim.audio.mime });
        }
      }
    } catch {
      // Provider and storage failures only change job scheduling.
    }
    if (!transcription) {
      await ports.retry(lease);
      return "retry";
    }
    rawText = transcription.text;
  }

  if (!await ports.validate(lease)) return "stale";
  let redactedText: string | null = null;
  if (ports.redact) {
    try {
      redactedText = (await ports.redact(rawText))?.trim() || null;
    } catch {
      // The restricted transcript may be retained. This result cannot publish.
    }
  }
  return ports.complete(lease, { transcription, redactedText });
}
