import { describe, expect, it, vi } from "vitest";
import { exportCurrentReport, readReportDisplay } from "../src/report-reader.js";

const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const studyId = id(1);
const quote = { studyId, transcriptId: id(3), sourceVersion: id(4), startChar: 0,
  endChar: 7, exactText: "ordered", confidence: 0.9 };
const current = { reportId: id(2), studyId, summary: { version: 2, executiveAnswer: "One order",
  themes: [{ claim: "A diner ordered soup", count: 1, total: 1, confidence: "medium",
    supportingQuotes: [quote], contradictingQuotes: [] }],
  hypotheses: [{ hypothesis: "Fees matter", result: "untested" }] } };

describe("qualified report view and export boundary", () => {
  it("shows a current public report and re-reads on export", async () => {
    const port = { readCurrent: vi.fn().mockResolvedValue(current) };
    expect(await readReportDisplay(port, studyId)).toEqual({ kind: "ready", report: current,
      exportAvailable: true });
    expect(JSON.parse((await exportCurrentReport(port, studyId))!)).toEqual(current);
    expect(port.readCurrent).toHaveBeenCalledTimes(2);
  });

  it("clears stale content after withdrawal, deletion, re-redaction or access loss", async () => {
    const port = { readCurrent: vi.fn().mockResolvedValueOnce(current).mockResolvedValue(null) };
    expect((await readReportDisplay(port, studyId)).kind).toBe("ready");
    expect(await exportCurrentReport(port, studyId)).toBeNull();
    expect(await readReportDisplay(port, studyId)).toEqual({ kind: "withheld",
      exportAvailable: false });
    port.readCurrent.mockRejectedValue(new Error("access revoked"));
    expect(await readReportDisplay(port, studyId)).toMatchObject({ kind: "withheld" });
    expect(await exportCurrentReport(port, studyId)).toBeNull();
  });

  it("rejects cross-study, unversioned or private researcher output", async () => {
    const bad = [
      { ...current, studyId: id(999) },
      { ...current, summary: { ...current.summary, version: 1 } },
      { ...current, summary: { ...current.summary, followUpBrief: { raw: "private" } } },
      { ...current, summary: { ...current.summary, themes: [{ ...current.summary.themes[0],
        supportingQuotes: [{ ...quote, rationale: "private" }] }] } },
      { ...current, summary: { ...current.summary, themes: [{ ...current.summary.themes[0],
        supportingQuotes: [{ ...quote, studyId: id(999) }] }] } },
    ];
    for (const value of bad) {
      const port = { readCurrent: vi.fn().mockResolvedValue(value) };
      expect(await readReportDisplay(port, studyId)).toMatchObject({ kind: "withheld" });
      expect(await exportCurrentReport(port, studyId)).toBeNull();
    }
  });
});
