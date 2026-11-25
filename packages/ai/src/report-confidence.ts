export type FindingConfidence = "high" | "medium" | "low";

/** Structural lower bounds from PRD 8.3; consistency and denominator are reviewed separately. */
export function meetsConfidenceFloor(count: number, total: number,
  confidence: FindingConfidence): boolean {
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(total)
    || count <= 0 || total < count) return false;
  if (confidence === "high") return BigInt(count) * 10n >= BigInt(total) * 6n;
  if (confidence === "medium") return BigInt(count) * 10n >= BigInt(total) * 3n;
  return confidence === "low";
}
