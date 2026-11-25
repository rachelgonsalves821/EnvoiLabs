import { expect, it } from "vitest";
import { summarizeCompleteProbeOpportunityLog, summarizeProbeAttemptLog,
  summarizeProbeOutcomes } from "../src/probe-metrics.js";

it("reports rendered p95 and separate no-probe, error and timeout rates", () => {
  const result = summarizeProbeOutcomes([
    ...Array.from({ length: 19 }, (_, index) => ({
      outcome: "rendered" as const, uploadConfirmedAtMs: 100,
      renderedAtMs: 100 + (index + 1) * 100,
    })),
    { outcome: "no_probe" }, { outcome: "error" }, { outcome: "timeout" },
  ]);
  expect(result).toMatchObject({ total: 22, rendered: 19, renderedP95Ms: 1900,
    noProbe: 1, errors: 1, timeouts: 1, timeoutRate: 1 / 22 });
  expect(summarizeProbeOutcomes([{ outcome: "no_probe" }]).renderedP95Ms).toBeNull();
  expect(() => summarizeProbeOutcomes([{ outcome: "rendered", uploadConfirmedAtMs: 3, renderedAtMs: 2 }]))
    .toThrow("Invalid probe timestamps");
});

it("keeps persisted decision and render timeouts separate without guessing unlabeled stages", () => {
  const result = summarizeProbeOutcomes([
    { outcome: "timeout", stage: "decision" },
    { outcome: "timeout", stage: "render" },
    { outcome: "timeout" },
    { outcome: "no_probe" },
  ]);
  expect(result).toMatchObject({ total: 4, timeouts: 3, timeoutRate: 0.75,
    decisionTimeouts: 1, renderTimeouts: 1, unclassifiedTimeouts: 1 });
  expect(() => summarizeProbeOutcomes([
    { outcome: "timeout", stage: "browser" } as unknown as
      Parameters<typeof summarizeProbeOutcomes>[0][number],
  ])).toThrow("Invalid probe timeout stage");
});

it("summarizes unique fictional turns by device without claiming a physical timing pass", () => {
  const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const records = [
    { turnId: id(1), device: "ios-safari" as const, evidence: "fixture" as const,
      result: { outcome: "rendered" as const, uploadConfirmedAtMs: 100,
        renderedAtMs: 5200 } },
    { turnId: id(2), device: "android-chrome" as const, evidence: "fixture" as const,
      result: { outcome: "timeout" as const } },
    { turnId: id(3), device: "android-chrome" as const, evidence: "fixture" as const,
      result: { outcome: "no_probe" as const } },
  ];
  expect(summarizeProbeAttemptLog(records)).toMatchObject({ evidence: "fixture",
    bothDeviceLabelsPresent: true,
    overall: { total: 3, rendered: 1, renderedP95Ms: 5100, noProbe: 1, timeouts: 1 },
    iosSafari: { total: 1, rendered: 1, renderedP95Ms: 5100 },
    androidChrome: { total: 2, rendered: 0, renderedP95Ms: null },
  });
  expect(summarizeProbeAttemptLog([])).toMatchObject({ evidence: "none",
    bothDeviceLabelsPresent: false, overall: { total: 0, renderedP95Ms: null } });
  expect(() => summarizeProbeAttemptLog([...records, records[0]!]))
    .toThrow("Invalid or duplicate probe attempt");
  expect(() => summarizeProbeAttemptLog([...records, { ...records[0]!,
    turnId: id(4), evidence: "physical-device" as const }]))
    .toThrow("Mixed fixture and physical-device evidence");
  expect(() => summarizeProbeAttemptLog([{ ...records[0]!,
    result: { outcome: "rendered" as const, uploadConfirmedAtMs: 100,
      renderedAtMs: Number.NaN } }])).toThrow("Invalid or duplicate probe attempt");
});

it("requires every qualified source-version opportunity in the timing denominator", () => {
  const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const opportunities = [
    { turnId: id(1), sourceVersion: id(11), browserUploadConfirmedAtMs: 100,
      device: "ios-safari" as const,
      evidence: "fixture" as const },
    { turnId: id(2), sourceVersion: id(12), browserUploadConfirmedAtMs: 200,
      device: "android-chrome" as const,
      evidence: "fixture" as const },
  ];
  const measured = [
    { ...opportunities[0]!, result: { outcome: "rendered" as const,
      uploadConfirmedAtMs: 100, renderedAtMs: 5200 } },
    { ...opportunities[1]!, result: { outcome: "timeout" as const } },
  ];
  expect(summarizeCompleteProbeOpportunityLog(opportunities, measured)).toMatchObject({
    overall: { total: 2, rendered: 1, renderedP95Ms: 5100, timeouts: 1,
      timeoutRate: 0.5 },
  });
  expect(summarizeCompleteProbeOpportunityLog(
    [opportunities[0]!, { ...opportunities[1]!, browserUploadConfirmedAtMs: null }],
    measured,
  )).toMatchObject({ overall: { total: 2, rendered: 1, timeouts: 1 } });
  expect(() => summarizeCompleteProbeOpportunityLog(
    [{ ...opportunities[0]!, browserUploadConfirmedAtMs: null }, opportunities[1]!],
    measured,
  )).toThrow("Probe outcome does not match current opportunity");
  expect(() => summarizeCompleteProbeOpportunityLog(
    [opportunities[0]!, { ...opportunities[1]!, browserUploadConfirmedAtMs: null }],
    [measured[0]!, { ...measured[1]!, result: { outcome: "no_probe" as const } }],
  )).toThrow("Probe outcome does not match current opportunity");
  expect(() => summarizeCompleteProbeOpportunityLog(opportunities, measured.slice(0, 1)))
    .toThrow("Incomplete probe opportunity outcomes");
  expect(() => summarizeCompleteProbeOpportunityLog(opportunities,
    [measured[0]!, { ...measured[1]!, sourceVersion: id(13) }]))
    .toThrow("Probe outcome does not match current opportunity");
  expect(() => summarizeCompleteProbeOpportunityLog(opportunities,
    [measured[0]!, { ...measured[1]!, turnId: id(3) }]))
    .toThrow("Probe outcome does not match current opportunity");
  expect(() => summarizeCompleteProbeOpportunityLog(opportunities,
    [measured[0]!, { ...measured[1]!, device: "ios-safari" as const }]))
    .toThrow("Probe outcome does not match current opportunity");
  expect(() => summarizeCompleteProbeOpportunityLog(opportunities,
    [{ ...measured[0]!, result: { ...measured[0]!.result,
      uploadConfirmedAtMs: 200 } }, measured[1]!]))
    .toThrow("Probe outcome does not match current opportunity");
  expect(() => summarizeCompleteProbeOpportunityLog(
    [{ ...opportunities[0]!, browserUploadConfirmedAtMs: Number.NaN },
      opportunities[1]!], measured))
    .toThrow("Invalid or duplicate probe opportunity");
  expect(() => summarizeCompleteProbeOpportunityLog(
    [opportunities[0]!, opportunities[0]!], measured))
    .toThrow("Invalid or duplicate probe opportunity");
});
