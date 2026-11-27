export interface MarketplaceFeasibilitySnapshot {
  readonly studyId: string;
  readonly eligibleProfileCount: number;
  readonly history: { readonly offered: number; readonly accepted: number;
    readonly completed: number };
  readonly projectedCompletes: number | null;
  readonly fillHours: null;
  readonly basis: "insufficient_history" | "observed_rates";
  readonly asOf: string;
}

export type FeasibilityView = {
  readonly eligibleProfiles: number;
  readonly projectedCompletes: number | null;
  readonly status: "insufficient_data" | "below_target" | "directional_supply";
  readonly asOf: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

/** View-only aggregate; checkout must make its own fresh authoritative read. */
export function describeMarketplaceFeasibility(value: unknown, studyId: string,
  targetRespondents: number): FeasibilityView | null {
  if (!uuid.test(studyId) || !Number.isSafeInteger(targetRespondents)
    || targetRespondents < 10 || !record(value)
    || !exact(value, ["studyId", "eligibleProfileCount", "history", "projectedCompletes",
      "fillHours", "basis", "asOf"])
    || value.studyId !== studyId || !count(value.eligibleProfileCount)
    || !record(value.history) || !exact(value.history, ["offered", "accepted", "completed"])
    || !count(value.history.offered) || !count(value.history.accepted)
    || !count(value.history.completed) || value.history.accepted > value.history.offered
    || value.history.completed > value.history.accepted || value.fillHours !== null
    || typeof value.asOf !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.asOf)
    || !Number.isFinite(Date.parse(value.asOf))) return null;
  const projected = value.projectedCompletes;
  if (value.basis === "insufficient_history") {
    if (projected !== null) return null;
    return { eligibleProfiles: value.eligibleProfileCount,
      projectedCompletes: null, status: value.eligibleProfileCount < targetRespondents
        ? "below_target" : "insufficient_data", asOf: value.asOf };
  }
  if (value.basis !== "observed_rates" || value.history.offered < 30
    || value.history.accepted < 10 || !count(projected)
    || projected > value.eligibleProfileCount) return null;
  return { eligibleProfiles: value.eligibleProfileCount, projectedCompletes: projected,
    status: value.eligibleProfileCount < targetRespondents || projected < targetRespondents
      ? "below_target" : "directional_supply", asOf: value.asOf };
}
