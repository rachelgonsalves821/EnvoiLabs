import { describe, expect, it, vi } from "vitest";
import { decideQualifiedScreeningAnswer } from
  "../src/qualified-screening-decision.js";

const request = { studyId: "90600000-0000-4000-8000-000000000001",
  answerId: "a9f30000-0000-4000-8000-000000000004",
  ruleId: "a9f30000-0000-4000-8000-000000000003", ruleVersion: 1,
  providerModel: "synthetic-model", promptVersion: "screening-v1",
  promptDigest: "a".repeat(64) };
const source = { studyId: request.studyId, answerId: request.answerId,
  ruleId: request.ruleId, ruleVersion: 1,
  criterionText: "Worked as a hospital nurse in the past 12 months",
  question: "Have you worked as a hospital nurse in the past 12 months?",
  redactedSourceVersion: "a9f30000-0000-4000-8000-000000000099",
  redactionPolicyDigest: "c".repeat(64),
  answerText: "I am a nurse. [email address removed]" };
const rule = { id: request.ruleId, studyId: request.studyId,
  criterionId: "a9f30000-0000-4000-8000-000000000001", version: 1,
  criterionKind: "must", criterionText: source.criterionText,
  timeframeText: "past 12 months", question: source.question,
  approvedAt: "2026-11-25T00:00:00Z" };

function setup() {
  let event: Record<string, unknown> | null = null;
  let current = source;
  let currentRule = rule;
  let currentAuthority = true;
  const rpc = vi.fn().mockImplementation(async (name: string,
    args: Record<string, unknown>) => {
    if (name === "get_gate2_current_qualified_screening_decision")
      return { data: currentAuthority ? event : null, error: null };
    if (name === "get_gate2_screening_decision")
      return { data: event, error: null };
    if (name === "get_gate2_screening_rule")
      return { data: currentRule, error: null };
    if (name === "current_gate2_screening_model_source")
      return { data: currentAuthority ? current : null, error: null };
    if (name === "commit_gate2_qualified_screening_decision") {
      event = { answerId: request.answerId, ruleId: request.ruleId,
        ruleVersion: 1, interpretation: args.requested_interpretation,
        span: args.requested_start === null ? null : {
          startChar: args.requested_start, endChar: args.requested_end },
        action: args.requested_action,
        confirmedFact: args.requested_confirmed,
        redactedSourceVersion: args.requested_source_version,
        redactionPolicyDigest: args.requested_redaction_policy_digest };
      return { data: event, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const model = { interpret: vi.fn().mockResolvedValue({ result: "supported",
    span: { startChar: 0, endChar: 13 } }),
  evidenceSupports: vi.fn().mockResolvedValue(true) };
  return { rpc, model, setCurrent(value: boolean) { currentAuthority = value; },
    changeSource(value: typeof source) { current = value; },
    changeRule(value: typeof rule) { currentRule = value; } };
}

describe("qualified screening decision service", () => {
  it("commits one qualified result and returns it on retry without another model call", async () => {
    const fixture = setup();
    expect((await decideQualifiedScreeningAnswer({ rpc: fixture.rpc },
      fixture.model, request))?.action).toBe("qualify");
    expect((await decideQualifiedScreeningAnswer({ rpc: fixture.rpc },
      fixture.model, request))?.action).toBe("qualify");
    expect(fixture.model.interpret).toHaveBeenCalledTimes(1);
    expect(fixture.model.evidenceSupports).toHaveBeenCalledTimes(1);
    expect(fixture.rpc).toHaveBeenCalledWith(
      "commit_gate2_qualified_screening_decision",
      expect.objectContaining({ requested_source_version: source.redactedSourceVersion,
        requested_redaction_policy_digest: source.redactionPolicyDigest,
        requested_action: "qualify" }));
  });

  it("does not revive a prior decision after consent withdrawal or re-redaction", async () => {
    const fixture = setup();
    await decideQualifiedScreeningAnswer({ rpc: fixture.rpc }, fixture.model, request);
    fixture.setCurrent(false);
    expect(await decideQualifiedScreeningAnswer({ rpc: fixture.rpc },
      fixture.model, request)).toBeNull();
    expect(fixture.model.interpret).toHaveBeenCalledTimes(1);
  });

  it("routes unsupported semantic evidence to review", async () => {
    const fixture = setup();
    fixture.model.evidenceSupports.mockResolvedValue(false);
    expect((await decideQualifiedScreeningAnswer({ rpc: fixture.rpc },
      fixture.model, request))?.action).toBe("review");
    expect(fixture.rpc).toHaveBeenCalledWith(
      "commit_gate2_qualified_screening_decision",
      expect.objectContaining({ requested_action: "review",
        requested_confirmed: null }));
  });

  it("does not call the model without the current qualified source", async () => {
    const fixture = setup();
    fixture.setCurrent(false);
    expect(await decideQualifiedScreeningAnswer({ rpc: fixture.rpc },
      fixture.model, request)).toBeNull();
    expect(fixture.model.interpret).not.toHaveBeenCalled();
  });

  it("blocks changed approved wording before interpretation", async () => {
    const fixture = setup();
    fixture.changeRule({ ...rule, criterionText: "Nurse at a hospital last month" });
    expect(await decideQualifiedScreeningAnswer({ rpc: fixture.rpc },
      fixture.model, request)).toBeNull();
    expect(fixture.model.interpret).not.toHaveBeenCalled();
    expect(fixture.rpc).not.toHaveBeenCalledWith(
      "commit_gate2_qualified_screening_decision", expect.anything());
  });

  it.each([
    "I was not a nurse in the past 12 months.",
    "My sister was a nurse; I was not.",
    "I might become a nurse next year.",
  ])("keeps unsupported negated, third-party or future answer in review: %s",
    async (answerText) => {
      const fixture = setup();
      fixture.changeSource({ ...source, answerText });
      fixture.model.evidenceSupports.mockResolvedValue(false);
      expect((await decideQualifiedScreeningAnswer({ rpc: fixture.rpc },
        fixture.model, request))?.action).toBe("review");
      expect(fixture.rpc).not.toHaveBeenCalledWith(
        "commit_gate2_qualified_screening_decision",
        expect.objectContaining({ requested_action: "qualify" }));
    });
});
