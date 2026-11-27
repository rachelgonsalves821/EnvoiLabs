import "@envoi-labs/ui/styles.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireResearcher } from "../../../../../server/auth/identity";
import { fictionalWalkthroughEnabled } from "../../../../../server/gate5/fictional-preview";
import { readResearcherStudyTracking } from "../../../../../server/researcher/study-tracking";
import workspace from "../../researcher.module.css";
import { trackingCopy as copy } from "./copy";
import { StudyTrackingPanel } from "./study-tracking-panel";
import { StudyReportMount } from "./study-report-mount";

export const metadata: Metadata = { title: "Study tracking and report | Envoi Labs" };

export default async function StudyTrackingPage({ params }: { params: Promise<{ studyId: string }> }) {
  await requireResearcher();
  const { studyId } = await params;
  const result = await readResearcherStudyTracking(studyId);
  if (result.status === 403 || result.status === 404) notFound();

  const available = result.status === 200;
  return (
    <div className={workspace.workspace}>
      <a className={workspace.skip} href="#study-tracking">{copy.skip}</a>
      <nav className={workspace.rail} aria-label={copy.navigation}>
        <span className={workspace.brand}>{copy.brand}</span>
        <a href="/app">{copy.newStudy}</a>
      </nav>
      <main className={workspace.main} id="study-tracking" tabIndex={-1}>
        <h1>{available ? result.title : copy.title}</h1>
        {fictionalWalkthroughEnabled() && <p role="status" style={{ padding: "0.85rem 1rem",
          border: "2px solid #8b5e00", borderRadius: "0.75rem",
          backgroundColor: "#fff2cc", fontWeight: 700 }}>
          Fictional product test · Payment simulated. The paid launch and any refund
          shown in this walkthrough use fictional provider observations.
        </p>}
        {available ? (
          <>
            <StudyTrackingPanel key={result.tracking.studyId} initial={result.tracking} targetCompletes={result.targetCompletes} />
            <StudyReportMount key={result.tracking.studyId} studyId={result.tracking.studyId} />
          </>
        ) : (
          <><p>{copy.unavailable}</p><a href={`/app/studies/${encodeURIComponent(studyId)}`}>{copy.retry}</a></>
        )}
      </main>
    </div>
  );
}
