import { describe, expect, it, vi } from "vitest";
import { publishGate2ScreeningRedaction } from "./screening-redaction-publisher";

const answerId = "a9f20000-0000-4000-8000-000000000004";
const studyId = "90600000-0000-4000-8000-000000000001";
const sourceVersion = "a9f20000-0000-4000-8000-000000000008";
const policyDigest = "a".repeat(64);
const qualificationDigest = "b".repeat(64);
const idempotencyKey = "gate2-redaction:a9f20000-0000-4000-8000-000000000009";
const answerText = "Nurse at Fiction Hospital, nurse@example.test";
const rawAnswerDigest = "377c6d4c69caeee1a08b3ff080d80a94ed813be815b4d12a5e6dde9802adb418";
const request = { answerId, policyDigest, qualificationDigest, idempotencyKey };
const input = { answerId, studyId, kind: "text", answerText, rawAnswerDigest,
  policyDigest, qualificationDigest };

describe("private screening redaction publisher", () => {
  it("publishes only the local Gate 1 redactor's qualified output", async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) =>
      name === "read_gate2_screening_redaction_input" && args.requested_answer_id === answerId
        ? { data: input, error: null }
        : { data: { sourceVersion, qualified: true }, error: null });
    const redact = vi.fn(async () => "Nurse at [redacted], [redacted]");
    const result = await publishGate2ScreeningRedaction({ rpc },
      { redact, policyDigest, qualificationDigest }, request);
    expect(result).toEqual({ sourceVersion, qualified: true });
    expect(redact).toHaveBeenCalledWith(answerText);
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({
      requested_raw_digest: rawAnswerDigest,
      requested_redacted_text: "Nurse at [redacted], [redacted]",
      requested_redaction_passed: true,
    });
  });

  it("writes a withheld source when local redaction fails", async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) =>
      name.startsWith("read_") && args.requested_answer_id === answerId
      ? { data: input, error: null }
      : { data: { sourceVersion, qualified: false }, error: null });
    expect(await publishGate2ScreeningRedaction({ rpc }, {
      policyDigest, qualificationDigest,
      redact: async () => { throw new Error("redactor unavailable"); },
    }, request)).toEqual({ sourceVersion, qualified: false });
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({
      requested_redacted_text: null, requested_redaction_passed: false,
    });
  });

  it("rejects policy mismatch and changed raw source before publication", async () => {
    const rpc = vi.fn(async () => ({ data: { ...input,
      rawAnswerDigest: "c".repeat(64) }, error: null }));
    const redact = vi.fn(async () => "safe");
    const port = { redact, policyDigest, qualificationDigest };
    expect(await publishGate2ScreeningRedaction({ rpc },
      { ...port, policyDigest: "d".repeat(64) }, request)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(await publishGate2ScreeningRedaction({ rpc }, port, request)).toBeNull();
    expect(redact).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not publish when the current-authority read is denied", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    expect(await publishGate2ScreeningRedaction({ rpc }, {
      policyDigest, qualificationDigest, redact: async () => "safe",
    }, request)).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
