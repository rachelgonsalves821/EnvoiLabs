export const qualityComponents = ["specificity", "relevance",
  "profileConsistency", "behavioral", "liveness"] as const;
export type QualityComponent = typeof qualityComponents[number];
export type QualitySignal = { value: number; receiptId: string } | null;
export type QualitySignals = Record<QualityComponent, QualitySignal>;
export type QualityConfig = {
  version: number;
  weights: Record<QualityComponent, number>;
  approveAt: number;
  removeBelow: number;
};
export type QualityResult = {
  configVersion: number;
  score: number | null;
  decision: "approve" | "review" | "remove";
  components: Record<QualityComponent, {
    value: number; weightedPoints: number; receiptId: string;
  }> | null;
  missing: QualityComponent[];
};

/** A pure calculation. The caller must authenticate immutable signal receipts
 * and bind this result to the submitted session before recording a decision. */
export function scoreSession(signals: QualitySignals,
  config: QualityConfig): QualityResult {
  const weights = qualityComponents.map((key) => config.weights?.[key]);
  if (!Number.isSafeInteger(config.version) || config.version < 1 ||
      !weights.every((weight) => Number.isSafeInteger(weight) &&
        weight >= 0 && weight <= 100) ||
      weights.reduce((total, weight) => total + weight, 0) !== 100 ||
      !Number.isSafeInteger(config.approveAt) ||
      !Number.isSafeInteger(config.removeBelow) ||
      config.removeBelow < 0 || config.approveAt > 100 ||
      config.removeBelow >= config.approveAt)
    throw new RangeError("Invalid versioned quality configuration");

  const missing: QualityComponent[] = [];
  for (const key of qualityComponents) {
    const signal = signals[key];
    if (signal === null || signal === undefined ||
        typeof signal.receiptId !== "string" || !signal.receiptId.trim()) {
      missing.push(key);
      continue;
    }
    if (!Number.isSafeInteger(signal.value) || signal.value < 0 ||
        signal.value > 100)
      throw new RangeError(`Invalid ${key} quality signal`);
  }
  if (missing.length > 0) return { configVersion: config.version,
    score: null, decision: "review", components: null, missing };

  const components = Object.fromEntries(qualityComponents.map((key) => {
    const signal = signals[key]!;
    return [key, { value: signal.value,
      weightedPoints: config.weights[key] * signal.value / 100,
      receiptId: signal.receiptId }];
  })) as QualityResult["components"];
  const score = Math.round(qualityComponents.reduce((total, key) =>
    total + components![key].weightedPoints, 0));
  const decision = score >= config.approveAt ? "approve" :
    score < config.removeBelow ? "remove" : "review";
  return { configVersion: config.version, score,
    decision, components, missing: [] };
}
