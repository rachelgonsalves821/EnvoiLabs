import { describe, expect, it } from "vitest";
import { MarketplaceFeasibilitySchema } from "@envoi-labs/contracts";
import { readMarketplaceFeasibility } from "../src/marketplace-feasibility";

const studyId = "019ac928-4718-7b62-b72d-8c9fb79b337c";
const insufficient = { studyId, eligibleProfileCount: 1,
  history: { offered: 1, accepted: 1, completed: 1 },
  projectedCompletes: null, fillHours: null, basis: "insufficient_history",
  asOf: "2026-11-24T18:00:00.000Z" };

describe("marketplace feasibility boundary", () => {
  it("returns observed supply without inventing a fill time from sparse history", async () => {
    const result = await readMarketplaceFeasibility(async () => ({
      data: insufficient, error: null }), studyId, "researcher");
    expect(result).toEqual({ status: 200, feasibility: insufficient });
    expect(MarketplaceFeasibilitySchema.safeParse({ ...insufficient,
      projectedCompletes: 1 }).success).toBe(false);
    expect(MarketplaceFeasibilitySchema.safeParse({ ...insufficient,
      fillHours: 24 }).success).toBe(false);
  });

  it("fails closed on cross-study data, denied access and malformed history", async () => {
    expect((await readMarketplaceFeasibility(async () => ({ data: {
      ...insufficient, studyId: "019ac928-4718-7b62-b72d-8c9fb79b337d" },
    error: null }), studyId, "researcher")).status).toBe(503);
    expect((await readMarketplaceFeasibility(async () => ({ data: null,
      error: { code: "42501" } }), studyId, "researcher")).status).toBe(404);
    expect(MarketplaceFeasibilitySchema.safeParse({ ...insufficient,
      history: { offered: 1, accepted: 0, completed: 1 } }).success).toBe(false);
  });
});
