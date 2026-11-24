import { describe, expect, it } from "vitest";
import type { LLMProvider, LLMResponse } from "../src/index.js";
import { evidenceSupports, type ScreeningEvidenceInput } from "../src/screening-evidence.js";

const criterion = "Has worked as a hospital nurse in the past 12 months";
const question = "Have you worked as a hospital nurse in the past 12 months?";
const input = (answerText: string, result: ScreeningEvidenceInput["result"], excerpt = answerText): ScreeningEvidenceInput => {
  const startChar = Array.from(answerText.slice(0, answerText.indexOf(excerpt))).length;
  return { criterionText: criterion, question, answerText, result,
    span: { startChar, endChar: startChar + Array.from(excerpt).length } };
};
const judgment = (relation: "supported" | "contradicted" | "ambiguous", evidenceText: string,
  overrides: Record<string, unknown> = {}) => ({
  relation, evidenceText, respondentOwnExperience: true,
  criterionAndTimeframeMatch: true, explicitNotInferred: true, ...overrides,
});
const provider = (output: unknown): LLMProvider => ({
  async generate(request): Promise<LLMResponse> {
    expect(request.purpose).toBe("screening-evidence");
    expect(request.messages[0]?.content).toContain("fullAnswer");
    return { output, model: "fictional-fixture", inputTokens: 0, outputTokens: 0,
      latencyMs: 0, costMicros: 0 };
  },
});

describe("screening evidence boundary", () => {
  it("accepts explicit supported and contradicted respondent evidence", async () => {
    const yes = "I worked as a hospital nurse this year.";
    const no = "I have never worked as a hospital nurse.";
    expect(await evidenceSupports(provider(judgment("supported", yes)), input(yes, "supported"))).toBe(true);
    expect(await evidenceSupports(provider(judgment("contradicted", no)), input(no, "contradicted"))).toBe(true);
  });

  it("fails closed for ambiguous, negated, third-party, and wrong-timeframe claims", async () => {
    const cases = [
      ["I might start hospital nursing next year.", "ambiguous", {}],
      ["My sister worked as a hospital nurse this year.", "supported", { respondentOwnExperience: false }],
      ["I worked as a hospital nurse five years ago.", "supported", { criterionAndTimeframeMatch: false }],
      ["I did not work as a hospital nurse this year.", "ambiguous", {}],
    ] as const;
    for (const [answer, relation, flags] of cases) {
      expect(await evidenceSupports(provider(judgment(relation, answer, flags)), input(answer, "supported"))).toBe(false);
    }
  });

  it("reads full context and requires an exact selected Unicode excerpt", async () => {
    const answer = "🩺 I was a nurse five years ago, but not this year.";
    const excerpt = "I was a nurse five years ago";
    const proposed = input(answer, "supported", excerpt);
    expect(await evidenceSupports(provider(judgment("ambiguous", excerpt)), proposed)).toBe(false);
    expect(await evidenceSupports(provider(judgment("supported", "nurse five years ago")), proposed)).toBe(false);
    expect(await evidenceSupports(provider(judgment("supported", excerpt)),
      { ...proposed, span: { startChar: 0, endChar: 999 } })).toBe(false);
  });

  it("treats judge failure or unapproved criterion as review", async () => {
    const answer = "I worked as a hospital nurse this year.";
    expect(await evidenceSupports(provider({ relation: "supported" }), input(answer, "supported"))).toBe(false);
    expect(await evidenceSupports({ generate: async () => { throw new Error("timeout"); } },
      input(answer, "supported"))).toBe(false);
    expect(await evidenceSupports(provider(judgment("supported", answer)),
      { ...input(answer, "supported"), criterionText: "" })).toBe(false);
  });
});

/** Held-out fictional exclusions: a false positive here would incorrectly screen someone out. */
const heldOutExclusions = [
  { answer: "My sister is a hospital nurse.", relation: "supported", own: false },
  { answer: "I hope to become a hospital nurse next year.", relation: "ambiguous", own: true },
  { answer: "I nursed in a hospital in 2020.", relation: "supported", own: true, time: false },
  { answer: "I never worked at a hospital.", relation: "contradicted", own: true },
  { answer: "I worked at a hospital, but only as a volunteer.", relation: "supported", own: true, time: false },
  { answer: "I am unsure whether my role counts as nursing.", relation: "ambiguous", own: true },
] as const;

it("held-out exclusion-error replay rejects all ambiguous or invalid support proposals", async () => {
  let falseExclusions = 0;
  for (const fixture of heldOutExclusions) {
    const decision = await evidenceSupports(provider(judgment(fixture.relation, fixture.answer, {
      respondentOwnExperience: fixture.own,
      criterionAndTimeframeMatch: "time" in fixture ? fixture.time : true,
    })), input(fixture.answer, "supported"));
    if (decision) falseExclusions++;
  }
  expect(falseExclusions).toBe(0);
});
