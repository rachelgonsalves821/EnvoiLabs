"use client";

import { reportBrowserPort, ReportUiController } from "@envoi-labs/ai";
import { useMemo } from "react";
import { StudyReportPanel } from "./study-report-panel";

export function StudyReportMount({ studyId }: { studyId: string }) {
  const controller = useMemo(() => new ReportUiController(reportBrowserPort(), studyId), [studyId]);
  return <StudyReportPanel controller={controller} />;
}
