"use client";

import { ReportUiController } from "@envoi-labs/ai";
import { useState } from "react";
import { StudyReportPanel } from "../(researcher)/app/studies/[studyId]/study-report-panel";

const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const studyId = id(1);
const fictionalReport = { reportId: id(2), studyId, summary: {
  version: 2 as const, executiveAnswer: "Fictional respondents asked for a clearer receipt.",
  themes: [{ claim: "Receipt clarity helps", count: 2, total: 3,
    confidence: "medium" as const, supportingQuotes: [{ studyId, transcriptId: id(3),
      sourceVersion: id(4), startChar: 0, endChar: 16,
      exactText: "A receipt helps.", confidence: 0.9 }], contradictingQuotes: [] }],
  hypotheses: [],
} };

export function ReportFixture() {
  const [fixture] = useState(() => {
    let current: typeof fictionalReport | null = fictionalReport;
    const controller = new ReportUiController({
      async readCurrent() {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        return current;
      },
    }, studyId);
    return { controller, revoke: () => { current = null; } };
  });

  return <main style={{ maxWidth: 760, marginInline: "auto", padding: 16 }}>
    <h1>Fictional report fixture</h1>
    <StudyReportPanel controller={fixture.controller} />
    <button data-fixture-revoke type="button" onClick={fixture.revoke}>Revoke fictional report</button>
  </main>;
}
