import { describe, expect, it, vi } from "vitest";
import { createGate2ScreeningModelUsePort,
  type ScreeningAuthorizationAttempt } from "../src/screening-model-authority.js";

const source = { studyId: "90600000-0000-4000-8000-000000000001",
  answerId: "a9f20000-0000-4000-8000-000000000004",
  ruleId: "a9f20000-0000-4000-8000-000000000003", ruleVersion: 1,
  criterionText: "Worked as a hospital nurse in the past 12 months",
  question: "Have you worked as a hospital nurse in the past 12 months?",
  redactedSourceVersion: "a9f20000-0000-4000-8000-000000000099",
  redactionPolicyDigest: "c".repeat(64),
  answerText: "I worked as a hospital nurse this year. Contact: [redacted]." };
async function attempt(): Promise<ScreeningAuthorizationAttempt> {
  const bytes = await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(JSON.stringify(source)));
  const sourceDigest = Array.from(new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { purpose: "ai_screening", providerModel: "synthetic-model",
    promptVersion: "screening-v1", promptDigest: "a".repeat(64),
    sourceDigest, studyId: source.studyId, answerId: source.answerId,
    ruleId: source.ruleId, ruleVersion: source.ruleVersion,
    redactedSourceVersion: source.redactedSourceVersion,
    redactionPolicyDigest: source.redactionPolicyDigest };
}

describe("current Gate 2 screening model authorization", () => {
  it("re-reads the exact policy-bound source for every authorization attempt", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: source, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const port = createGate2ScreeningModelUsePort({ rpc });
    expect(await port.authorize(await attempt())).toBe(true);
    expect(await port.authorize(await attempt())).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("current_gate2_screening_model_source", {
      requested_study_id: source.studyId, requested_answer_id: source.answerId,
      requested_rule_id: source.ruleId, requested_rule_version: 1,
      requested_provider_model: "synthetic-model",
      requested_prompt_version: "screening-v1",
      requested_prompt_digest: "a".repeat(64),
    });
  });

  it("rejects stale answer or wording even when the database returns an authorized row", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      ...source, answerText: "My sister worked as a hospital nurse." }, error: null });
    const port = createGate2ScreeningModelUsePort({ rpc });
    expect(await port.authorize(await attempt())).toBe(false);
    rpc.mockResolvedValue({ data: { ...source, criterionText: "Nurse last year" }, error: null });
    expect(await port.authorize(await attempt())).toBe(false);
    rpc.mockResolvedValue({ data: { ...source,
      redactedSourceVersion: "a9f20000-0000-4000-8000-000000000098" }, error: null });
    expect(await port.authorize(await attempt())).toBe(false);
    rpc.mockResolvedValue({ data: { ...source,
      redactionPolicyDigest: "d".repeat(64) }, error: null });
    expect(await port.authorize(await attempt())).toBe(false);
  });

  it("fails closed for an invalid purpose, malformed receipt and database outage", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("unavailable"));
    const port = createGate2ScreeningModelUsePort({ rpc });
    expect(await port.authorize({ ...await attempt(), purpose: "ai_followup" as "ai_screening" }))
      .toBe(false);
    expect(await port.authorize({ ...await attempt(), promptDigest: "wrong" })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(await port.authorize(await attempt())).toBe(false);
  });
});
