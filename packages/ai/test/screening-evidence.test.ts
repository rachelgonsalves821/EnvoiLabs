import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { LLMProvider, LLMResponse } from "../src/index.js";
import { evidenceSupports, type ScreeningEvidenceInput } from "../src/screening-evidence.js";

const criterion = "Has worked as a hospital nurse in the past 12 months";
const question = "Have you worked as a hospital nurse in the past 12 months?";
const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const config = { providerModel: "fictional-fixture", promptVersion: "screening-evidence-v1",
  timeoutMs: 100 };
const input = (answerText: string, result: ScreeningEvidenceInput["result"], excerpt = answerText): ScreeningEvidenceInput => {
  const startChar = Array.from(answerText.slice(0, answerText.indexOf(excerpt))).length;
  return { studyId: id(1), answerId: id(2), ruleId: id(3), ruleVersion: 1,
    criterionText: criterion, question, answerText, result,
    span: { startChar, endChar: startChar + Array.from(excerpt).length } };
};
const judgment = (relation: "supported" | "contradicted" | "ambiguous", evidenceText: string,
  overrides: Record<string, unknown> = {}) => ({
  relation, evidenceText, respondentOwnExperience: true,
  criterionAndTimeframeMatch: true, explicitNotInferred: true, ...overrides,
});
const provider = (output: unknown): LLMProvider => ({
  async generate(request): Promise<LLMResponse> {
    expect(request.purpose).toBe("ai_screening");
    expect(request.promptVersion).toBe(config.promptVersion);
    expect(request.messages[0]?.content).toContain("fullAnswer");
    return { output, model: "fictional-fixture", inputTokens: 0, outputTokens: 0,
      latencyMs: 0, costMicros: 0 };
  },
});
const authorizedEvidenceSupports = (model: LLMProvider, candidate: ScreeningEvidenceInput) =>
  evidenceSupports(model, candidate, config, { authorize: async () => true });

describe("screening evidence boundary", () => {
  it("denies model dispatch without current screening authorization", async () => {
    const candidate = input("I worked as a hospital nurse this year.", "supported");
    const generate = vi.fn(async () => ({ output: judgment("supported", candidate.answerText),
      model: "fictional", inputTokens: 0, outputTokens: 0, latencyMs: 0, costMicros: 0 }));
    expect(await evidenceSupports({ generate }, candidate, config)).toBe(false);
    expect(await evidenceSupports({ generate }, candidate, config,
      { authorize: async () => false })).toBe(false);
    expect(await evidenceSupports({ generate }, candidate, config,
      { authorize: async () => "false" as unknown as boolean })).toBe(false);
    expect(await evidenceSupports({ generate }, candidate, config,
      { authorize: async () => { throw new Error("consent read failed"); } })).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it("accepts explicit supported and contradicted respondent evidence", async () => {
    const yes = "I worked as a hospital nurse this year.";
    const no = "I have never worked as a hospital nurse.";
    expect(await authorizedEvidenceSupports(provider(judgment("supported", yes)), input(yes, "supported"))).toBe(true);
    expect(await authorizedEvidenceSupports(provider(judgment("contradicted", no)), input(no, "contradicted"))).toBe(true);
  });

  it("binds current screening consent to exact source/rule and provider prompt", async () => {
    const candidate = input("I worked as a hospital nurse this year.", "supported");
    const authorize = vi.fn().mockResolvedValue(true);
    expect(await evidenceSupports(provider(judgment("supported", candidate.answerText)),
      candidate, config, { authorize })).toBe(true);
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(authorize).toHaveBeenCalledWith({ purpose: "ai_screening",
      providerModel: config.providerModel, promptVersion: config.promptVersion,
      promptDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      studyId: candidate.studyId, answerId: candidate.answerId,
      ruleId: candidate.ruleId, ruleVersion: 1,
      sourceDigest: createHash("sha256").update(JSON.stringify({
        studyId: candidate.studyId, answerId: candidate.answerId,
        ruleId: candidate.ruleId, ruleVersion: candidate.ruleVersion,
        criterionText: candidate.criterionText, question: candidate.question,
        answerText: candidate.answerText,
      })).digest("hex") });
    expect(JSON.stringify(authorize.mock.calls)).not.toContain(candidate.answerText);
  });

  it("withholds when screening consent or source authority is revoked during inference", async () => {
    const candidate = input("I worked as a hospital nurse this year.", "supported");
    const authorize = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    expect(await evidenceSupports(provider(judgment("supported", candidate.answerText)),
      candidate, config, { authorize })).toBe(false);
    const mutable = { ...candidate, span: { ...candidate.span } };
    const generate = vi.fn(async () => ({ output: judgment("supported", candidate.answerText),
      model: config.providerModel, inputTokens: 0, outputTokens: 0, latencyMs: 0, costMicros: 0 }));
    const policy = vi.fn(async () => { mutable.answerText = "A different answer."; return true; });
    expect(await evidenceSupports({ generate }, mutable, config,
      { authorize: policy })).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    expect(JSON.stringify(policy.mock.calls)).not.toContain(candidate.answerText);
  });

  it("makes no model call when the second current screening check denies dispatch", async () => {
    const candidate = input("I worked as a hospital nurse this year.", "supported");
    const generate = vi.fn(async () => ({ output: judgment("supported", candidate.answerText),
      model: config.providerModel, inputTokens: 0, outputTokens: 0, latencyMs: 0, costMicros: 0 }));
    const authorize = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await evidenceSupports({ generate }, candidate, config, { authorize })).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it("bounds authorization and does not dispatch after a missed deadline", async () => {
    const candidate = input("I worked as a hospital nurse this year.", "supported");
    const generate = vi.fn(async () => ({ output: judgment("supported", candidate.answerText),
      model: config.providerModel, inputTokens: 0, outputTokens: 0, latencyMs: 0, costMicros: 0 }));
    expect(await evidenceSupports({ generate }, candidate, { ...config, timeoutMs: 1 },
      { authorize: () => new Promise<boolean>(() => undefined) })).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it("withholds a late judge result and rechecks current source after inference", async () => {
    const candidate = input("I worked as a hospital nurse this year.", "supported");
    const generate = vi.fn(() => new Promise<LLMResponse>((resolve) => {
      setTimeout(() => resolve({ output: judgment("supported", candidate.answerText),
        model: config.providerModel, inputTokens: 0, outputTokens: 0,
        latencyMs: 0, costMicros: 0 }), 20);
    }));
    const authorize = vi.fn().mockResolvedValue(true);
    expect(await evidenceSupports({ generate }, candidate, { ...config, timeoutMs: 1 },
      { authorize })).toBe(false);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledTimes(2);
    const changed = { ...candidate, span: { ...candidate.span } };
    expect(await evidenceSupports({ generate: async () => {
      changed.answerText = "A changed answer.";
      return { output: judgment("supported", candidate.answerText),
        model: config.providerModel, inputTokens: 0, outputTokens: 0,
        latencyMs: 0, costMicros: 0 };
    } }, changed, config, { authorize: async () => true })).toBe(false);
  });

  it("does not dispatch after the approved judge configuration changes", async () => {
    const candidate = input("I worked as a hospital nurse this year.", "supported");
    const mutable = { ...config };
    const generate = vi.fn(async () => ({ output: judgment("supported", candidate.answerText),
      model: config.providerModel, inputTokens: 0, outputTokens: 0, latencyMs: 0, costMicros: 0 }));
    expect(await evidenceSupports({ generate }, candidate, mutable,
      { authorize: async () => { mutable.promptVersion = "unapproved"; return true; } }))
      .toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it("withholds if the approved rule changes during authorization or inference", async () => {
    const candidate = input("I worked as a hospital nurse this year.", "supported");
    const mutable = { ...candidate, span: { ...candidate.span } };
    const generate = vi.fn(async () => ({ output: judgment("supported", candidate.answerText),
      model: config.providerModel, inputTokens: 0, outputTokens: 0, latencyMs: 0, costMicros: 0 }));
    expect(await evidenceSupports({ generate }, mutable, config, { authorize: async () => {
      mutable.ruleVersion = 2;
      return true;
    } })).toBe(false);
    expect(generate).not.toHaveBeenCalled();
    const later = { ...candidate, span: { ...candidate.span } };
    expect(await evidenceSupports({ generate: async () => {
      later.criterionText = "A different criterion";
      return { output: judgment("supported", candidate.answerText),
        model: config.providerModel, inputTokens: 0, outputTokens: 0,
        latencyMs: 0, costMicros: 0 };
    } }, later, config, { authorize: async () => true })).toBe(false);
  });

  it("rejects missing source identity and a provider/model mismatch", async () => {
    const candidate = input("I worked as a hospital nurse this year.", "supported");
    expect(await authorizedEvidenceSupports(provider(judgment("supported", candidate.answerText)),
      { ...candidate, answerId: "not-an-id" })).toBe(false);
    expect(await evidenceSupports(provider(judgment("supported", candidate.answerText)),
      candidate, { ...config, providerModel: "unapproved-model" },
      { authorize: async () => true })).toBe(false);
  });

  it("fails closed for ambiguous, negated, third-party, and wrong-timeframe claims", async () => {
    const cases = [
      ["I might start hospital nursing next year.", "ambiguous", {}],
      ["My sister worked as a hospital nurse this year.", "supported", { respondentOwnExperience: false }],
      ["I worked as a hospital nurse five years ago.", "supported", { criterionAndTimeframeMatch: false }],
      ["I did not work as a hospital nurse this year.", "ambiguous", {}],
    ] as const;
    for (const [answer, relation, flags] of cases) {
      expect(await authorizedEvidenceSupports(provider(judgment(relation, answer, flags)), input(answer, "supported"))).toBe(false);
    }
  });

  it("reads full context and requires an exact selected Unicode excerpt", async () => {
    const answer = "🩺 I was a nurse five years ago, but not this year.";
    const excerpt = "I was a nurse five years ago";
    const proposed = input(answer, "supported", excerpt);
    expect(await authorizedEvidenceSupports(provider(judgment("ambiguous", excerpt)), proposed)).toBe(false);
    expect(await authorizedEvidenceSupports(provider(judgment("supported", "nurse five years ago")), proposed)).toBe(false);
    expect(await authorizedEvidenceSupports(provider(judgment("supported", excerpt)),
      { ...proposed, span: { startChar: 0, endChar: 999 } })).toBe(false);
  });

  it("treats judge failure or unapproved criterion as review", async () => {
    const answer = "I worked as a hospital nurse this year.";
    expect(await authorizedEvidenceSupports(provider({ relation: "supported" }), input(answer, "supported"))).toBe(false);
    expect(await authorizedEvidenceSupports({ generate: async () => { throw new Error("timeout"); } },
      input(answer, "supported"))).toBe(false);
    expect(await authorizedEvidenceSupports(provider(judgment("supported", answer)),
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
    const decision = await authorizedEvidenceSupports(provider(judgment(fixture.relation, fixture.answer, {
      respondentOwnExperience: fixture.own,
      criterionAndTimeframeMatch: "time" in fixture ? fixture.time : true,
    })), input(fixture.answer, "supported"));
    if (decision) falseExclusions++;
  }
  expect(falseExclusions).toBe(0);
});
