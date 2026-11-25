import { expect, it } from "vitest";
import { assessPersistedProbeCoverage, type PersistedProbeOpportunity } from
  "../src/probe-opportunity-coverage.js";

const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, values: Partial<PersistedProbeOpportunity>): PersistedProbeOpportunity => ({
  answerId: id(n), currentQualified: true, currentTurn: true,
  outcome: "no_probe", renderOutcome: null, ...values,
});

it("separates surviving terminal decisions from unresolved and withheld opportunities", () => {
  const items = [
    row(1, { outcome: "rendered", renderOutcome: "shown" }),
    row(2, { outcome: "timeout" }),
    row(3, { outcome: "timeout", renderOutcome: "timeout" }),
    row(4, { outcome: "pending_render" }),
    row(5, { outcome: "invalidated", currentTurn: false }),
    row(6, { outcome: "withheld", currentQualified: false }),
    row(7, { outcome: "pending", currentTurn: false }),
    row(8, { outcome: "superseded", currentTurn: false }),
    row(9, { outcome: "superseded", renderOutcome: "superseded" }),
  ];
  expect(assessPersistedProbeCoverage({ recordedCount: items.length, items }))
    .toEqual({ survivingRecorded: 9, withheld: 1, invalidated: 1,
      pending: 1, pendingRender: 1, terminal: 5,
      decisionTimeouts: 1, renderTimeouts: 1,
      terminalCoverageComplete: false });
  expect(assessPersistedProbeCoverage({ recordedCount: 7,
    items: items.filter((item) => item.outcome !== "pending"
      && item.outcome !== "pending_render") }).terminalCoverageComplete).toBe(true);
  expect(assessPersistedProbeCoverage({ recordedCount: 0, items: [] })
    .terminalCoverageComplete).toBe(false);
});

it("fails closed on missing, duplicate or inconsistent persisted outcomes", () => {
  const rendered = row(1, { outcome: "rendered", renderOutcome: "shown" });
  expect(() => assessPersistedProbeCoverage({ recordedCount: 2, items: [rendered] }))
    .toThrow("Incomplete private probe snapshot");
  expect(() => assessPersistedProbeCoverage({ recordedCount: 2, items: [rendered, rendered] }))
    .toThrow("Invalid private probe outcome");
  for (const bad of [
    row(2, { outcome: "rendered", renderOutcome: null }),
    row(2, { outcome: "pending_render", renderOutcome: "timeout" }),
    row(2, { outcome: "timeout", renderOutcome: "shown" }),
    row(2, { outcome: "timeout", renderOutcome: "superseded" }),
    row(2, { outcome: "superseded", renderOutcome: "superseded", currentTurn: false }),
    row(2, { outcome: "rendered", renderOutcome: "shown", currentTurn: false }),
    row(2, { outcome: "withheld", currentQualified: true }),
    row(2, { outcome: "invalidated", currentTurn: true }),
  ]) expect(() => assessPersistedProbeCoverage({ recordedCount: 1, items: [bad] }))
    .toThrow("Invalid private probe outcome");
});
