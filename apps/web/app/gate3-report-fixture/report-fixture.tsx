"use client";

import { reportBrowserPort, ReportUiController } from "@envoi-labs/ai";
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
const replacementReport = { ...fictionalReport, reportId: id(5), summary: {
  ...fictionalReport.summary,
  executiveAnswer: "A newer fictional report favors a current receipt.",
  themes: [{ ...fictionalReport.summary.themes[0]!, claim: "Current receipts help",
    supportingQuotes: [{ ...fictionalReport.summary.themes[0]!.supportingQuotes[0]!,
      transcriptId: id(6), sourceVersion: id(7), endChar: 26,
      exactText: "The current receipt helps." }] }],
} };

export function ReportFixture() {
  const [fixture] = useState(() => {
    let current: typeof fictionalReport | null = fictionalReport;
    let paused: Promise<void> | null = null;
    let release: (() => void) | null = null;
    const controller = new ReportUiController({
      async readCurrent() {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        if (paused) await paused;
        return current;
      },
    }, studyId);
    return { controller, revoke: () => { current = null; },
      replace: () => { current = replacementReport; },
      pause: () => { if (!paused) paused = new Promise<void>((resolve) => { release = resolve; }); },
      resume: () => { release?.(); paused = null; release = null; } };
  });

  return <main style={{ maxWidth: 760, marginInline: "auto", padding: 16 }}>
    <h1>Fictional report fixture</h1>
    <StudyReportPanel controller={fixture.controller} />
    <button data-fixture-revoke type="button" onClick={fixture.revoke}>Revoke fictional report</button>
    <button data-fixture-replace type="button" onClick={fixture.replace}>Replace fictional report</button>
    <button data-fixture-pause type="button" onClick={fixture.pause}>Pause fictional read</button>
    <button data-fixture-resume type="button" onClick={fixture.resume}>Resume fictional read</button>
  </main>;
}

/** Exercises the browser fetch port with Playwright-intercepted fictional responses. */
export function EndpointReportFixture() {
  const [controller] = useState(() => new ReportUiController(reportBrowserPort(), studyId));
  return <main style={{ maxWidth: 760, marginInline: "auto", padding: 16 }}>
    <h1>Fictional report endpoint fixture</h1>
    <StudyReportPanel controller={controller} />
  </main>;
}
