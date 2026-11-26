import { describe, expect, it } from "vitest";
import { scoreSession, type QualityConfig, type QualitySignals } from "../src/quality.js";

const config: QualityConfig = { version: 1,
  weights: { specificity: 30, relevance: 25, profileConsistency: 20,
    behavioral: 15, liveness: 10 }, approveAt: 60, removeBelow: 45 };
const uniform = (value: number): QualitySignals => ({
  specificity: { value, receiptId: "specificity:v1" },
  relevance: { value, receiptId: "relevance:v1" },
  profileConsistency: { value, receiptId: "profile:v1" },
  behavioral: { value, receiptId: "behavior:v1" },
  liveness: { value, receiptId: "liveness:v1" },
});

describe("versioned quality score", () => {
  it("uses configured weights and both exact decision boundaries", () => {
    expect(scoreSession(uniform(44), config)).toMatchObject({ score: 44,
      decision: "remove", configVersion: 1 });
    expect(scoreSession(uniform(45), config)).toMatchObject({ score: 45,
      decision: "review" });
    expect(scoreSession(uniform(59), config)).toMatchObject({ score: 59,
      decision: "review" });
    expect(scoreSession(uniform(60), config)).toMatchObject({ score: 60,
      decision: "approve" });
    const mixed = scoreSession({ ...uniform(0),
      specificity: { value: 100, receiptId: "specificity:v2" },
      liveness: { value: 100, receiptId: "liveness:v2" } }, config);
    expect(mixed.score).toBe(40);
    expect(mixed.components?.specificity).toEqual({ value: 100,
      weightedPoints: 30, receiptId: "specificity:v2" });
  });

  it("routes missing or unreceipted signals to review without a fake zero", () => {
    const result = scoreSession({ ...uniform(100), relevance: null,
      liveness: { value: 100, receiptId: "  " } }, config);
    expect(result).toEqual({ configVersion: 1, score: null,
      decision: "review", components: null,
      missing: ["relevance", "liveness"] });
  });

  it("rejects an invalid signal or configuration instead of deciding", () => {
    expect(() => scoreSession(uniform(101), config)).toThrow(RangeError);
    expect(() => scoreSession(uniform(0), { ...config, version: 0 }))
      .toThrow(RangeError);
    expect(() => scoreSession(uniform(0), { ...config,
      weights: { ...config.weights, specificity: 31 } })).toThrow(RangeError);
    expect(() => scoreSession(uniform(0), { ...config,
      removeBelow: 60 })).toThrow(RangeError);
  });
});
