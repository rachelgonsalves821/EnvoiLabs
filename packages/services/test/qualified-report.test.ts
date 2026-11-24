import { describe, expect, it, vi } from "vitest";
import { AnalystThemeSetV2Schema } from "@envoi-labs/contracts";
import { publicationQuoteMap, publishQualifiedThemeSet } from "../src/qualified-report.js";

const analyst = AnalystThemeSetV2Schema.parse(
  (AnalystThemeSetV2Schema.meta()?.examples as unknown[])[0]);
const policy = { policyDigest: "a".repeat(64), qualificationDigest: "b".repeat(64) };
const privateString = "Ada Example, ada@example.test, +1 555 010 0100, Acme Corp, 12 Example St";

function setup() {
  const ports = {
    activePolicy: vi.fn().mockResolvedValue(policy),
    qualifyText: vi.fn().mockImplementation(async (text: string) => ({ ...policy,
      text: text.replaceAll(privateString, "[redacted]") })),
    verifyQuote: vi.fn().mockImplementation(async (candidate: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "rationale"))),
    publish: vi.fn().mockResolvedValue(true),
  };
  return ports;
}

describe("qualified report publication boundary", () => {
  it("qualifies executive, hypothesis and claim text before any researcher shape exists", async () => {
    const ports = setup();
    const raw = { ...analyst, executiveAnswer: privateString,
      hypotheses: [{ hypothesis: privateString, result: "supported" as const }],
      themes: [{ ...analyst.themes[0], claim: privateString }] };
    const publicReport = await publishQualifiedThemeSet(ports, "report_1", raw);
    expect(publicReport).not.toBeNull();
    const exposed = JSON.stringify(publicReport);
    for (const secret of ["Ada Example", "ada@example.test", "+1 555 010 0100",
      "Acme Corp", "12 Example St", "rationale", "followUpBrief"]) {
      expect(exposed).not.toContain(secret);
    }
    expect(ports.qualifyText).toHaveBeenCalledTimes(3);
    expect(ports.publish).toHaveBeenCalledWith("report_1", publicReport,
      publicationQuoteMap(publicReport!), policy);
  });

  it("fails closed when the qualified policy or any text qualification is unavailable", async () => {
    const ports = setup();
    ports.activePolicy.mockResolvedValue(null);
    expect(await publishQualifiedThemeSet(ports, "report_1", analyst)).toBeNull();
    expect(ports.publish).not.toHaveBeenCalled();
    ports.activePolicy.mockResolvedValue(policy);
    ports.qualifyText.mockResolvedValue(null);
    expect(await publishQualifiedThemeSet(ports, "report_1", analyst)).toBeNull();
    expect(ports.publish).not.toHaveBeenCalled();
  });

  it("rejects a qualification receipt or quote that changes provenance", async () => {
    const ports = setup();
    ports.qualifyText.mockResolvedValue({ ...policy, qualificationDigest: "c".repeat(64), text: "safe" });
    expect(await publishQualifiedThemeSet(ports, "report_1", analyst)).toBeNull();
    ports.qualifyText.mockImplementation(async (text: string) => ({ ...policy, text }));
    ports.verifyQuote.mockResolvedValue({ ...analyst.themes[0]!.supportingQuotes[0],
      sourceVersion: "22222222-2222-4222-8222-222222222222" });
    expect(await publishQualifiedThemeSet(ports, "report_1", analyst)).toBeNull();
    expect(ports.publish).not.toHaveBeenCalled();
  });

  it("returns no public content when persistence rejects a stale publication", async () => {
    const ports = setup();
    ports.publish.mockResolvedValue(false);
    expect(await publishQualifiedThemeSet(ports, "report_1", analyst)).toBeNull();
  });
});
