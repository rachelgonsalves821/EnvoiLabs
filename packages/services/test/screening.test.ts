import { describe, expect, it, vi } from "vitest";
import { screenSubmittedAnswer } from "../src/screening.js";

const studyId = "90600000-0000-4000-8000-000000000001";
const ruleId = "a9700000-0000-4000-8000-000000000001";
const rule = { id: ruleId, studyId, criterionId: ruleId, version: 3,
  criterionKind: "must" as const, criterionText: "Ordered soup in the last 30 days",
  timeframeText: "last 30 days", question: "Did you order soup in the last 30 days?",
  approvedAt: "2026-11-23T00:00:00.000Z" };
const submitted = { inviteId: "invite_1", respondentId: "respondent_1",
  studyId, ruleId, ruleVersion: 3,
  text: "I ordered 😀 soup.",
  kind: "text" as const, transcriptionConsentVersion: null,
  idempotencyKey: "screening:invite_1:rule_3" };

function setup() {
  const decisions = new Map<string, unknown>();
  const ports = {
    getApprovedRule: vi.fn().mockResolvedValue(rule),
    storeAnswer: vi.fn().mockImplementation(async (input: object) => ({
      ...input, id: "answer_1" })),
    getDecision: vi.fn().mockImplementation(async (id: string) => decisions.get(id) ?? null),
    interpret: vi.fn().mockResolvedValue({ result: "supported",
      span: { startChar: 2, endChar: 16 } }),
    evidenceSupports: vi.fn().mockResolvedValue(true),
    commitDecision: vi.fn().mockImplementation(async (decision: { answerId: string }) => {
      decisions.set(decision.answerId, decision); return decision;
    }),
  };
  return ports;
}

describe("versioned screener service", () => {
  it("qualifies only after semantic validation and rechecks the invite at delivery", async () => {
    const ports = setup();
    const result = await screenSubmittedAnswer(ports, submitted);
    expect(result).toMatchObject({ action: "qualify", confirmedFact: true,
      ruleId, ruleVersion: 3 });
    expect(ports.evidenceSupports).toHaveBeenCalledOnce();
    expect(ports.commitDecision).toHaveBeenCalledWith(result);
    expect(ports.storeAnswer).toHaveBeenCalledWith(submitted);
  });

  it("screens out a contradicted must rule and a supported exclusion rule", async () => {
    const must = setup();
    must.interpret.mockResolvedValue({ result: "contradicted", span: { startChar: 2, endChar: 9 } });
    expect((await screenSubmittedAnswer(must, submitted))?.action).toBe("screen_out");
    const exclusion = setup();
    exclusion.getApprovedRule.mockResolvedValue({ ...rule, criterionKind: "exclude" });
    expect((await screenSubmittedAnswer(exclusion, submitted))?.action).toBe("screen_out");
  });

  it("sends unclear, unsupported and invalid evidence to clarification or review", async () => {
    const unclear = setup();
    unclear.interpret.mockResolvedValue({ result: "unclear", span: null });
    expect((await screenSubmittedAnswer(unclear, submitted))?.action).toBe("clarify");
    expect(unclear.commitDecision).toHaveBeenCalledOnce();
    const unsupported = setup();
    unsupported.evidenceSupports.mockResolvedValue(false);
    expect((await screenSubmittedAnswer(unsupported, submitted))?.action).toBe("review");
    expect(unsupported.commitDecision).toHaveBeenCalledOnce();
    const invalid = setup();
    invalid.interpret.mockResolvedValue({ result: "supported", span: { startChar: 0, endChar: 99 } });
    expect((await screenSubmittedAnswer(invalid, submitted))?.action).toBe("clarify");
  });

  it("keeps timeout, consent failure, stale rule and replay fail closed", async () => {
    const timeout = setup();
    timeout.interpret.mockRejectedValue(new Error("timeout"));
    expect((await screenSubmittedAnswer(timeout, submitted))?.action).toBe("clarify");
    const voice = setup();
    expect(await screenSubmittedAnswer(voice, { ...submitted, kind: "voice" })).toBeNull();
    expect(voice.storeAnswer).not.toHaveBeenCalled();
    const transcribed = setup();
    const receiptId = "a9b10000-0000-4000-8000-000000000020";
    expect((await screenSubmittedAnswer(transcribed, { ...submitted,
      kind: "voice", transcriptionConsentVersion: "voice-v1",
      transcriptionReceiptId: receiptId }))?.action).toBe("qualify");
    expect(transcribed.storeAnswer).toHaveBeenCalledOnce();
    const stale = setup();
    stale.getApprovedRule.mockResolvedValue({ ...rule, studyId: ruleId });
    expect(await screenSubmittedAnswer(stale, submitted)).toBeNull();
    stale.getApprovedRule.mockResolvedValue(rule);
    expect(await screenSubmittedAnswer(stale, { ...submitted, ruleVersion: 2 })).toBeNull();
    const replay = setup();
    const first = await screenSubmittedAnswer(replay, submitted);
    expect(await screenSubmittedAnswer(replay, submitted)).toEqual(first);
    expect(replay.interpret).toHaveBeenCalledOnce();
    expect(replay.commitDecision).toHaveBeenCalledOnce();
  });

  it("never advances an invite when the transactional cap recheck fails", async () => {
    const ports = setup();
    ports.commitDecision.mockResolvedValueOnce(null);
    expect(await screenSubmittedAnswer(ports, submitted)).toBeNull();
    expect(ports.commitDecision).toHaveBeenCalledOnce();
    expect((await screenSubmittedAnswer(ports, submitted))?.action).toBe("qualify");
    expect(ports.commitDecision).toHaveBeenCalledTimes(2);
  });
});
