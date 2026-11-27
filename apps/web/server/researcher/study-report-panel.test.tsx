import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StudyReportPanel, type ReportPanelController } from "../../app/(researcher)/app/studies/[studyId]/study-report-panel";

type PanelState = ReturnType<ReportPanelController["getState"]>;

function render(state: PanelState) {
  const controller: ReportPanelController = {
    getState: () => state,
    subscribe: () => () => {},
    refresh: async () => state,
    requestExport: async () => null,
  };
  return renderToStaticMarkup(<StudyReportPanel controller={controller} />);
}

it("keeps one focusable action during a report authorization check", () => {
  const html = render({ kind: "loading", canExport: false });
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain("Checking report…");
  expect(html.match(/<button /g)).toHaveLength(1);
  expect(html).not.toContain("<blockquote>");
  expect(html).not.toContain(" disabled=");
});

it("offers a retry without displaying stale report evidence when withheld", () => {
  const html = render({ kind: "withheld", canExport: false });
  expect(html).toContain("The report is currently unavailable.");
  expect(html).toContain("Check again");
  expect(html.match(/<button /g)).toHaveLength(1);
  expect(html).not.toContain("<blockquote>");
  expect(html).not.toContain("Download themes and quotes CSV");
});

it("renders only the current report evidence with an export action", () => {
  const html = render({ kind: "ready", canExport: true, report: {
    reportId: "fictional-report", summary: {
      executiveAnswer: "The fictional respondents preferred a clear receipt.",
      themes: [{ claim: "Receipts improve clarity", count: 2, total: 3,
        confidence: "medium", supportingQuotes: [{ exactText: "A receipt helps.",
          transcriptId: "fictional-transcript" }], contradictingQuotes: [] }],
      hypotheses: [],
    },
  } });
  expect(html).toContain("A receipt helps.");
  expect(html).toContain("Download themes and quotes CSV");
  expect(html.match(/<button /g)).toHaveLength(1);
  expect(html).not.toContain('aria-disabled="true"');
});
