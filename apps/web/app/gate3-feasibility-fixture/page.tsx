import "@envoi-labs/ui/styles.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudyFeasibilityLivePanel } from "../(researcher)/app/study-feasibility-live-panel";

export const metadata: Metadata = { title: "Envoi Labs" };

/** Fictional browser harness; never serve this route from a production build. */
export default function Gate3FeasibilityFixturePage() {
  if (process.env.NODE_ENV !== "development" || process.env.ENVOI_GATE3_FEASIBILITY_FIXTURE !== "1")
    notFound();
  return <main style={{ maxWidth: 760, marginInline: "auto", padding: 16 }}>
    <h1>Fictional matching outlook fixture</h1>
    <StudyFeasibilityLivePanel studyId="a9700000-0000-4000-8000-000000000001"
      targetRespondents={12} />
  </main>;
}
