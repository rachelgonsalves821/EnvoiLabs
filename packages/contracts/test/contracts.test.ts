import { describe, expect, it } from "vitest";
import {
  BriefSchema, BriefPatchSchema, CriterionSchema, EvidenceQuoteReferenceSchema,
  GuideDraftSchema, InterviewProgressSchema, InvitePreviewSchema, ProbeDecisionSchema,
  QualitySignalsSchema, ScopingTurnSchema, ThemeSchema, ThemeSetSchema,
} from "../src/index.js";

const id = "019ac928-4718-7b62-b72d-8c9fb79b337c";
const deadlineAt = "2026-11-21T18:00:00.000Z";
const criterion = { kind: "must", text: "Ordered delivery in the last 30 days" };
const brief = {
  title: "Late-night delivery",
  decision: "Which delivery fees should we test?",
  hypotheses: ["Fees matter more for small orders."],
  criteria: [criterion],
  targetCompletes: 12,
  stimulus: null,
  deadlineAt,
};
const quote = { transcriptId: id, startChar: 4, endChar: 28 };
const theme = {
  claim: "Fees matter more for small orders.",
  count: 8,
  total: 12,
  confidence: "high",
  supportingQuotes: [quote],
  contradictingQuotes: [],
};
const invite = {
  id, title: brief.title, rewardCents: 280, lengthMinutes: 10,
  coreQuestionCount: 7, expiresAt: deadlineAt, whyYou: criterion.text,
};

describe("shared contract examples", () => {
  it.each([
    ["criterion", CriterionSchema, criterion],
    ["brief", BriefSchema, brief],
    ["brief patch", BriefPatchSchema, { targetCompletes: 20 }],
    ["guide", GuideDraftSchema, { coreQuestions: [
      "When did you last order?", "What did you order?", "Where did you order from?",
      "How much did delivery cost?", "How did you choose?", "What would you do next time?",
    ] }],
    ["scoping turn", ScopingTurnSchema, {
      message: "What decision are you trying to make?",
      quickReplies: ["Pricing", "Something else"],
      briefPatch: {},
    }],
    ["probe", ProbeDecisionSchema, { action: "probe", text: "What made you pick that app?" }],
    ["next", ProbeDecisionSchema, { action: "next" }],
    ["quality signal", QualitySignalsSchema, {
      specificity: 90, relevance: 75, profileConsistent: null,
    }],
    ["quote", EvidenceQuoteReferenceSchema, quote],
    ["theme", ThemeSchema, theme],
    ["theme set", ThemeSetSchema, {
      executiveAnswer: "Test a lower fee on small orders.",
      themes: [theme],
      hypotheses: [{ hypothesis: brief.hypotheses[0], result: "supported" }],
      followUpBrief: brief,
    }],
    ["invite", InvitePreviewSchema, invite],
    ["progress", InterviewProgressSchema, {
      sessionId: id, currentQuestion: 3, coreQuestionCount: 7, rewardCents: 280,
    }],
  ] as const)("round-trips %s", (_name, schema, example) => {
    expect(schema.parse(JSON.parse(JSON.stringify(example)))).toEqual(example);
  });

  it("rejects pricing and unexpected fields in an AI-authored brief patch", () => {
    expect(BriefPatchSchema.safeParse({ targetCompletes: 20, priceCents: 300 }).success).toBe(false);
  });

  it("rejects incomplete probes and follow-up text on next decisions", () => {
    expect(ProbeDecisionSchema.safeParse({ action: "probe" }).success).toBe(false);
    expect(ProbeDecisionSchema.safeParse({ action: "next", text: "Why?" }).success).toBe(false);
  });

  it("rejects reversed quote offsets and inconsistent theme counts", () => {
    expect(EvidenceQuoteReferenceSchema.safeParse({ ...quote, endChar: 2 }).success).toBe(false);
    expect(ThemeSchema.safeParse({ ...theme, count: 13 }).success).toBe(false);
  });

  it("rejects fractional rewards and progress beyond the last question", () => {
    expect(InvitePreviewSchema.safeParse({ ...invite, rewardCents: 2.8 }).success).toBe(false);
    expect(InterviewProgressSchema.safeParse({
      sessionId: id, currentQuestion: 8, coreQuestionCount: 7, rewardCents: 280,
    }).success).toBe(false);
  });
});
