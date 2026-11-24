import type { PublicReportSnapshot } from "./report-reader.js";

const columns = ["report_id", "study_id", "report_label", "theme_position", "claim",
  "count", "total", "confidence", "evidence_role", "quote_text", "transcript_id",
  "source_version", "start_char", "end_char", "quote_confidence"] as const;

function cell(value: string | number): string {
  let text = String(value);
  // Spreadsheet importers may evaluate quoted cells that begin with a formula.
  if (/^[\s\uFEFF]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Serialize an already validated, current-qualified snapshot for a researcher download. */
export function serializeReportCsv(report: PublicReportSnapshot): string {
  const lines: string[] = [columns.map(cell).join(",")];
  for (const [index, theme] of report.summary.themes.entries()) {
    for (const [role, quotes] of [
      ["supporting", theme.supportingQuotes],
      ["contradicting", theme.contradictingQuotes],
    ] as const) {
      for (const quote of quotes) {
        lines.push([report.reportId, report.studyId, "Directional qualitative", index + 1,
          theme.claim, theme.count, theme.total, theme.confidence, role, quote.exactText,
          quote.transcriptId, quote.sourceVersion, quote.startChar, quote.endChar,
          quote.confidence]
          .map(cell).join(","));
      }
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
