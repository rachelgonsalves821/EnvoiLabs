import { describe, expect, it, vi } from "vitest";
import { createScreeningAdapter } from "../src/screening-adapter.js";
import { screenSubmittedAnswer } from "../src/screening.js";

const rule = { id: "a9b10000-0000-4000-8000-000000000003",
  studyId: "90600000-0000-4000-8000-000000000001",
  criterionId: "a9b10000-0000-4000-8000-000000000001", version: 1,
  criterionKind: "must", criterionText: "Worked as a hospital nurse in the past 12 months",
  timeframeText: "past 12 months",
  question: "Have you worked as a hospital nurse in the past 12 months?",
  approvedAt: "2026-11-23T00:00:00+00:00" };
const input = { respondentId: "90500000-0000-4000-8000-000000000001",
  inviteId: "a9b10000-0000-4000-8000-000000000002", studyId: rule.studyId,
  ruleId: rule.id, ruleVersion: 1, kind: "text" as const,
  text: "My sister was a nurse, but I was not.",
  transcriptionConsentVersion: null, idempotencyKey: "screening:synthetic:1" };

function setup() {
  const rpc = vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "get_gate2_screening_rule") return { data: rule, error: null };
    if (name === "store_gate2_screening_answer") return { data: {
      id: "a9b10000-0000-4000-8000-000000000004", inviteId: args.requested_invite_id,
      studyId: args.requested_study_id, ruleId: args.requested_rule_id,
      ruleVersion: args.requested_version, kind: args.requested_kind,
      text: args.requested_text,
      transcriptionConsentVersion: args.requested_consent_version,
      idempotencyKey: args.requested_key,
    }, error: null };
    if (name === "get_gate2_screening_decision") return { data: null, error: null };
    if (name === "commit_gate2_screening_decision") return { data: {
      answerId: args.requested_answer_id, ruleId: args.requested_rule_id,
      ruleVersion: args.requested_version, interpretation: args.requested_interpretation,
      span: args.requested_start === null ? null : {
        startChar: args.requested_start, endChar: args.requested_end },
      action: args.requested_action, confirmedFact: args.requested_confirmed,
    }, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
  const agent3 = { interpret: vi.fn().mockResolvedValue({ result: "supported",
    span: { startChar: 0, endChar: 19 } }),
    evidenceSupports: vi.fn().mockResolvedValue(false) };
  return { rpc, agent3 };
}

describe("screening database and Gate 3 adapter", () => {
  it("sends frozen wording and the full negated answer to Gate 3, then records review", async () => {
    const { rpc, agent3 } = setup();
    const decision = await screenSubmittedAnswer(createScreeningAdapter({ rpc }, agent3), input);
    expect(decision?.action).toBe("review");
    expect(agent3.evidenceSupports).toHaveBeenCalledWith({
      criterionText: rule.criterionText, question: rule.question,
      answerText: input.text, result: "supported",
      span: { startChar: 0, endChar: 19 },
    });
    expect(rpc).toHaveBeenCalledWith("commit_gate2_screening_decision",
      expect.objectContaining({ requested_action: "review", requested_confirmed: null }));
  });

  it("fails closed for stale rule and cross-study answer RPC rejection", async () => {
    const stale = setup();
    expect(await screenSubmittedAnswer(createScreeningAdapter({ rpc: stale.rpc }, stale.agent3),
      { ...input, ruleVersion: 2 })).toBeNull();
    expect(stale.rpc).not.toHaveBeenCalledWith("store_gate2_screening_answer", expect.anything());
    const denied = setup();
    denied.rpc.mockImplementation(async (name: string) => ({
      data: name === "get_gate2_screening_rule" ? rule : null,
      error: name === "store_gate2_screening_answer" ? { code: "42501" } : null,
    }));
    expect(await screenSubmittedAnswer(createScreeningAdapter({ rpc: denied.rpc }, denied.agent3),
      input)).toBeNull();
    expect(denied.agent3.interpret).not.toHaveBeenCalled();
  });

  it.each([
    "My sister worked as a hospital nurse this year, but I did not.",
    "I might work as a hospital nurse next year.",
    "I worked as a hospital nurse five years ago, not in the past 12 months.",
  ])("keeps ambiguous, third-party and negated answers in review: %s", async (text) => {
    const { rpc, agent3 } = setup();
    agent3.interpret.mockResolvedValue({ result: "supported",
      span: { startChar: 0, endChar: Math.min(18, Array.from(text).length) } });
    const result = await screenSubmittedAnswer(createScreeningAdapter({ rpc }, agent3),
      { ...input, text });
    expect(result?.action).toBe("review");
    expect(agent3.evidenceSupports).toHaveBeenCalledWith(expect.objectContaining({
      answerText: text, criterionText: rule.criterionText }));
    expect(rpc).not.toHaveBeenCalledWith("commit_gate2_screening_decision",
      expect.objectContaining({ requested_action: "screen_out" }));
  });
});
