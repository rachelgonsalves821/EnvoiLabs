import "@envoi-labs/ui/styles.css";
import { notFound } from "next/navigation";
import { requireResearcher } from "../../../../../server/auth/identity";
import { readResearcherStudyTracking } from "../../../../../server/researcher/study-tracking";
import workspace from "../../researcher.module.css";
import { trackingCopy as copy } from "./copy";
import { StudyTrackingPanel } from "./study-tracking-panel";

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
        {available ? (
          <StudyTrackingPanel key={result.tracking.studyId} initial={result.tracking} targetCompletes={result.targetCompletes} />
        ) : (
          <><p>{copy.unavailable}</p><a href={`/app/studies/${encodeURIComponent(studyId)}`}>{copy.retry}</a></>
        )}
      </main>
    </div>
  );
}
