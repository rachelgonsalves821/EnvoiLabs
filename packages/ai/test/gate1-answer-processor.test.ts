import { describe, expect, it, vi } from "vitest";
import { ProviderError, runGate1AnswerJob, withTranscriptionFallback, type Gate1ProcessingPorts } from "../src/index.js";

const lease = { answerId: "answer-fixture", leaseId: "lease-fixture" };
const bytes = new TextEncoder().encode("abc");
const voice = {
  ...lease, kind: "voice" as const,
  audio: { storagePath: "session-fixture/recording", bytes: 3, mime: "audio/webm",
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" },
};
const transcript = { text: "A synthetic answer", provider: "fixture", model: "asr-fixture", latencyMs: 12, costMicros: 1 };

function setup() {
  const ports = {
    claim: vi.fn<Gate1ProcessingPorts["claim"]>().mockResolvedValue(voice),
    validate: vi.fn<Gate1ProcessingPorts["validate"]>().mockResolvedValue(true),
    readRecording: vi.fn<Gate1ProcessingPorts["readRecording"]>().mockResolvedValue(bytes),
    transcriber: { transcribe: vi.fn().mockResolvedValue(transcript) },
    redact: vi.fn<NonNullable<Gate1ProcessingPorts["redact"]>>().mockResolvedValue("A synthetic [redacted] answer"),
    complete: vi.fn<Gate1ProcessingPorts["complete"]>().mockResolvedValue("published"),
    retry: vi.fn<Gate1ProcessingPorts["retry"]>().mockResolvedValue(undefined),
  };
  return ports;
}

describe("Gate 1 answer processor", () => {
  it("uses the ASR fallback with the verified bytes and keeps its provider metadata", async () => {
    const ports = setup();
    const primary = { transcribe: vi.fn().mockRejectedValue(new ProviderError("openai", "timeout")) };
    const fallback = { transcribe: vi.fn().mockResolvedValue(transcript) };
    const transcriber = withTranscriptionFallback(primary, fallback);
    await expect(runGate1AnswerJob({ ...ports, transcriber })).resolves.toBe("published");
    expect(primary.transcribe).toHaveBeenCalledTimes(2);
    expect(fallback.transcribe).toHaveBeenCalledOnce();
    expect(ports.complete).toHaveBeenCalledWith(lease, { transcription: transcript, redactedText: "A synthetic [redacted] answer" });
  });

  it("does not retry or change vendors after consent or lease is revoked", async () => {
    const ports = setup();
    ports.validate.mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const primary = { transcribe: vi.fn().mockRejectedValue(new ProviderError("openai", "timeout")) };
    const fallback = { transcribe: vi.fn().mockResolvedValue(transcript) };
    await expect(runGate1AnswerJob({ ...ports,
      transcriber: withTranscriptionFallback(primary, fallback) })).resolves.toBe("stale");
    expect(primary.transcribe).toHaveBeenCalledOnce();
    expect(fallback.transcribe).not.toHaveBeenCalled();
    expect(ports.retry).not.toHaveBeenCalled();
    expect(ports.complete).not.toHaveBeenCalled();
  });

  it("does not send audio to the fallback after the second primary failure if consent lapses", async () => {
    const ports = setup();
    ports.validate.mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    const primary = { transcribe: vi.fn().mockRejectedValue(new ProviderError("openai", "transport")) };
    const fallback = { transcribe: vi.fn().mockResolvedValue(transcript) };
    await expect(runGate1AnswerJob({ ...ports,
      transcriber: withTranscriptionFallback(primary, fallback) })).resolves.toBe("stale");
    expect(primary.transcribe).toHaveBeenCalledTimes(2);
    expect(fallback.transcribe).not.toHaveBeenCalled();
    expect(ports.retry).not.toHaveBeenCalled();
  });

  it("processes typed text through redaction without ASR or recording reads", async () => {
    const ports = setup();
    ports.claim.mockResolvedValue({ ...lease, kind: "text", rawText: transcript.text });
    await expect(runGate1AnswerJob(ports)).resolves.toBe("published");
    expect(ports.readRecording).not.toHaveBeenCalled();
    expect(ports.transcriber.transcribe).not.toHaveBeenCalled();
    expect(ports.complete).toHaveBeenCalledWith(lease, {
      transcription: null, redactedText: "A synthetic [redacted] answer",
    });
  });

  it("releases the lease after a storage or byte-integrity failure for another attempt", async () => {
    const ports = setup();
    ports.readRecording.mockResolvedValueOnce(new TextEncoder().encode("xyz"));
    await expect(runGate1AnswerJob(ports)).resolves.toBe("retry");
    expect(ports.transcriber.transcribe).not.toHaveBeenCalled();
    expect(ports.retry).toHaveBeenCalledWith(lease);
    await expect(runGate1AnswerJob(ports)).resolves.toBe("published");
  });

  it("rechecks consent after reading storage and before external ASR", async () => {
    const ports = setup();
    ports.validate.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(runGate1AnswerJob(ports)).resolves.toBe("stale");
    expect(ports.transcriber.transcribe).not.toHaveBeenCalled();
    expect(ports.complete).not.toHaveBeenCalled();
  });

  it("stops after provider processing if the latest consent denies use", async () => {
    const ports = setup();
    ports.validate.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(runGate1AnswerJob(ports)).resolves.toBe("stale");
    expect(ports.transcriber.transcribe).toHaveBeenCalledOnce();
    expect(ports.redact).not.toHaveBeenCalled();
    expect(ports.complete).not.toHaveBeenCalled();
  });

  it("commits only the restricted transcript after an unavailable or failed redactor", async () => {
    const ports = setup();
    ports.redact.mockRejectedValueOnce(new Error("Synthetic worker failure"));
    ports.complete.mockResolvedValue("private");
    await expect(runGate1AnswerJob(ports)).resolves.toBe("private");
    await expect(runGate1AnswerJob({ ...ports, redact: null })).resolves.toBe("private");
    expect(ports.complete).toHaveBeenCalledTimes(2);
    expect(ports.complete).toHaveBeenLastCalledWith(lease, { transcription: transcript, redactedText: null });
  });
});
