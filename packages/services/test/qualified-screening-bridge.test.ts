import { describe, expect, it, vi } from "vitest";
import { createQualifiedScreeningBridge } from
  "../src/qualified-screening-bridge.js";

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

describe("qualified screening bridge", () => {
  it("sends only the qualified redacted source to both model ports", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: source, error: null });
    const model = { interpret: vi.fn().mockResolvedValue({ result: "supported",
      span: { startChar: 0, endChar: 21 } }),
    evidenceSupports: vi.fn().mockResolvedValue(true) };
    const bridge = createQualifiedScreeningBridge({ rpc }, model);
    const read = await bridge.interpret(request);
    expect(read?.source).toEqual(source);
    expect(model.interpret).toHaveBeenCalledWith(source);
    expect(await bridge.evidenceSupports(request, source, "supported",
      { startChar: 0, endChar: 21 })).toBe(true);
    expect(model.evidenceSupports).toHaveBeenCalledWith({ ...source,
      result: "supported", span: { startChar: 0, endChar: 21 } });
    expect(JSON.stringify(model.interpret.mock.calls)).not.toContain("nurse@example.test");
  });

  it("blocks a changed source, revoked consent, or stale span before evidence", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: source, error: null });
    const model = { interpret: vi.fn(), evidenceSupports: vi.fn() };
    const bridge = createQualifiedScreeningBridge({ rpc }, model);
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await bridge.interpret(request)).toBeNull();
    expect(model.interpret).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: { ...source,
      redactedSourceVersion: "a9f20000-0000-4000-8000-000000000098" }, error: null });
    expect(await bridge.evidenceSupports(request, source, "supported",
      { startChar: 0, endChar: 21 })).toBe(false);
    expect(await bridge.evidenceSupports(request, source, "supported",
      { startChar: 0, endChar: 999 })).toBe(false);
    expect(model.evidenceSupports).not.toHaveBeenCalled();
  });
});
