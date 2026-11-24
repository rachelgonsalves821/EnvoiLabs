import { expect, it } from "vitest";
import { serializeReportCsv } from "../src/report-csv.js";
import type { PublicReportSnapshot } from "../src/report-reader.js";

const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;

it("exports qualified themes and quotes as safe UTF-8 CSV with report provenance", () => {
  const quote = { studyId: id(1), transcriptId: id(3), sourceVersion: id(4),
    startChar: 0, endChar: 7, confidence: 0.9 };
  const report: PublicReportSnapshot = { reportId: id(2), studyId: id(1),
    summary: { version: 2, executiveAnswer: "Fictional answer", hypotheses: [], themes: [
      { claim: '=HYPERLINK("https://example.invalid")', count: 1, total: 2,
        confidence: "medium", supportingQuotes: [
          { ...quote, exactText: ' \t=cmd,"quoted"\nnext line' }],
        contradictingQuotes: [{ ...quote, transcriptId: id(5), exactText: "@SUM(1)" }] },
    ] } };
  const csv = serializeReportCsv(report);
  expect(csv.startsWith("\uFEFF")).toBe(true);
  expect(csv).toContain('"report_id","study_id","report_label"');
  expect(csv).toContain(`"${id(2)}","${id(1)}","Directional qualitative"`);
  expect(csv).toContain('"\'=HYPERLINK(""https://example.invalid"")"');
  expect(csv).toContain('"\' \t=cmd,""quoted""\nnext line"');
  expect(csv).toContain('"\'@SUM(1)"');
  expect(csv).toContain('"supporting"');
  expect(csv).toContain('"contradicting"');
  expect(csv).toContain(`"${id(4)}","0","7","0.9"`);
  expect(csv).not.toContain("Fictional answer");
  expect(csv.endsWith("\r\n")).toBe(true);
});
