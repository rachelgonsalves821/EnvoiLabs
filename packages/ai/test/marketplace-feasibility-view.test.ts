import { expect, it, vi } from "vitest";
import { describeMarketplaceFeasibility } from "../src/marketplace-feasibility-view.js";
import { readMarketplaceFeasibilityView } from "../src/marketplace-feasibility-browser.js";

const studyId = "a9700000-0000-4000-8000-000000000001";
const sparse = { studyId, eligibleProfileCount: 14,
  history: { offered: 4, accepted: 2, completed: 1 },
  projectedCompletes: null, fillHours: null, basis: "insufficient_history",
  asOf: "2026-11-24T20:00:00.000Z" } as const;
const observed = { ...sparse, eligibleProfileCount: 25,
  history: { offered: 40, accepted: 20, completed: 16 },
  projectedCompletes: 20, basis: "observed_rates" } as const;

it("keeps sparse history and low supply distinct from a fill promise", () => {
  expect(describeMarketplaceFeasibility(sparse, studyId, 10)?.status).toBe("insufficient_data");
  expect(describeMarketplaceFeasibility({ ...sparse, eligibleProfileCount: 9 }, studyId, 10)?.status)
    .toBe("below_target");
  expect(describeMarketplaceFeasibility(sparse, studyId, 10)?.projectedCompletes).toBeNull();
});

it("accepts projected eligible completes above purchased slots and flags a shortfall", () => {
  expect(describeMarketplaceFeasibility(observed, studyId, 10)).toMatchObject({
    eligibleProfiles: 25, projectedCompletes: 20, status: "directional_supply" });
  expect(describeMarketplaceFeasibility({ ...observed, projectedCompletes: 8 }, studyId, 10)?.status)
    .toBe("below_target");
});

it("withholds wrong-study, identifying, numeric-fill-time and inconsistent aggregates", () => {
  for (const value of [
    { ...observed, studyId: "a9700000-0000-4000-8000-000000000002" },
    { ...observed, respondentEmail: "fictional@example.invalid" },
    { ...observed, fillHours: 36 },
    { ...observed, projectedCompletes: 26 },
    { ...observed, history: { offered: 40, accepted: 41, completed: 16 } },
    { ...sparse, projectedCompletes: 9 },
  ]) expect(describeMarketplaceFeasibility(value, studyId, 10)).toBeNull();
});

it("requires an authenticated fresh private response before showing feasibility", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(observed),
    { status: 200, headers: { "cache-control": "private, no-store" } }))
    .mockResolvedValueOnce(new Response(JSON.stringify(observed),
      { status: 200, headers: { "cache-control": "no-store" } }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect(await readMarketplaceFeasibilityView(studyId, 10, fetcher)).toMatchObject({
    status: "directional_supply" });
  expect(await readMarketplaceFeasibilityView(studyId, 10, fetcher)).toBeNull();
  expect(await readMarketplaceFeasibilityView(studyId, 10, fetcher)).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher).toHaveBeenCalledWith(`/api/researcher/studies/${studyId}/feasibility`,
    expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
});
