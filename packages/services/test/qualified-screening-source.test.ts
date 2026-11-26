import { describe, expect, it, vi } from "vitest";
import { readGate2QualifiedScreeningSource } from
  "../src/qualified-screening-source.js";

const request = { studyId: "90600000-0000-4000-8000-000000000001",
  answerId: "a9f20000-0000-4000-8000-000000000004",
  ruleId: "a9f20000-0000-4000-8000-000000000003", ruleVersion: 1,
  providerModel: "synthetic-model", promptVersion: "screening-v1",
  promptDigest: "a".repeat(64) };
const source = { studyId: request.studyId, answerId: request.answerId,
  ruleId: request.ruleId, ruleVersion: 1,
  criterionText: "Worked as a hospital nurse in the past 12 months",
  question: "Have you worked as a hospital nurse in the past 12 months?",
  redactedSourceVersion: "a9f20000-0000-4000-8000-000000000099",
  redactionPolicyDigest: "c".repeat(64),
  answerText: "I worked as a nurse. Email: [redacted]." };

describe("qualified screening model source", () => {
  it("supplies only the current redacted tuple and re-reads on every call", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: source, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    expect(await readGate2QualifiedScreeningSource({ rpc }, request)).toEqual(source);
    expect(await readGate2QualifiedScreeningSource({ rpc }, request)).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("current_gate2_screening_model_source", {
      requested_study_id: request.studyId, requested_answer_id: request.answerId,
      requested_rule_id: request.ruleId, requested_rule_version: 1,
      requested_provider_model: request.providerModel,
      requested_prompt_version: request.promptVersion,
      requested_prompt_digest: request.promptDigest,
    });
  });

  it("refuses raw, malformed and cross-study source rows", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...source,
      rawAnswerText: "nurse@example.test" }, error: null });
    expect(await readGate2QualifiedScreeningSource({ rpc }, request)).toBeNull();
    rpc.mockResolvedValue({ data: { ...source, studyId:
      "90600000-0000-4000-8000-000000000002" }, error: null });
    expect(await readGate2QualifiedScreeningSource({ rpc }, request)).toBeNull();
    rpc.mockResolvedValue({ data: { ...source,
      redactedSourceVersion: "invalid" }, error: null });
    expect(await readGate2QualifiedScreeningSource({ rpc }, request)).toBeNull();
  });

  it("fails closed for an outage or invalid request", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("unavailable"));
    expect(await readGate2QualifiedScreeningSource({ rpc }, request)).toBeNull();
    expect(await readGate2QualifiedScreeningSource({ rpc },
      { ...request, promptDigest: "bad" })).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
