import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ProviderError, runGate1AnswerJob, withTranscriptionFallback } from "@envoi-labs/ai";

const answerId = "00000000-0000-4000-8000-000000000041";
const leaseId = "00000000-0000-4000-8000-000000000042";
const bytes = new Uint8Array([1, 2, 3]);
const audio = { storagePath: `${answerId}/00000000-0000-4000-8000-000000000043`,
  mime: "audio/webm", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
const lease = { answerId, leaseId };
const claim = { ...lease, kind: "voice" as const, audio };
const result = { text: "synthetic answer", provider: "fallback", model: "fixture", latencyMs: 4, costMicros: 0 };

function ports(transcriber: ReturnType<typeof withTranscriptionFallback>) {
  return {
    claim: vi.fn(async () => claim), validate: vi.fn(async () => true),
    readRecording: vi.fn(async () => bytes), transcriber,
    redact: vi.fn(async () => "synthetic answer"),
    complete: vi.fn(async () => "private" as const), retry: vi.fn(async () => {}),
  };
}

describe("Gate 4 synthetic transcription outage", () => {
  it("retries the answer after both providers fail, then falls back on the next lease", async () => {
    const primary = { transcribe: vi.fn(async () => { throw new ProviderError("openai", "timeout"); }) };
    const fallback = { transcribe: vi.fn().mockRejectedValueOnce(new ProviderError("groq", "transport"))
      .mockResolvedValueOnce(result) };
    const work = ports(withTranscriptionFallback(primary, fallback));
    const nextLease = { ...claim, leaseId: "00000000-0000-4000-8000-000000000044" };
    work.claim.mockResolvedValueOnce(claim).mockResolvedValueOnce(nextLease);

    await expect(runGate1AnswerJob(work)).resolves.toBe("retry");
    expect(work.retry).toHaveBeenCalledOnce();
    expect(work.retry).toHaveBeenCalledWith(lease);
    expect(work.complete).not.toHaveBeenCalled();

    await expect(runGate1AnswerJob(work)).resolves.toBe("private");
    expect(primary.transcribe).toHaveBeenCalledTimes(2);
    expect(fallback.transcribe).toHaveBeenCalledTimes(2);
    expect(work.complete).toHaveBeenCalledOnce();
    expect(work.complete).toHaveBeenCalledWith({ answerId, leaseId: nextLease.leaseId },
      { transcription: result, redactedText: "synthetic answer" });
  });

  it("does not complete a stale lease after a delayed provider response", async () => {
    const provider = { transcribe: vi.fn(async () => result) };
    const work = ports(withTranscriptionFallback(provider, provider));
    work.validate.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(runGate1AnswerJob(work)).resolves.toBe("stale");
    expect(work.complete).not.toHaveBeenCalled();
    expect(work.redact).not.toHaveBeenCalled();
    expect(work.retry).not.toHaveBeenCalled();
  });
});
