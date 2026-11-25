import "@envoi-labs/ui/styles.css";
import { notFound } from "next/navigation";
import { ReportFixture } from "./report-fixture";

/** Fictional browser harness; never serve this route from a production build. */
export default function Gate3ReportFixturePage() {
  if (process.env.NODE_ENV !== "development" || process.env.ENVOI_GATE3_REPORT_FIXTURE !== "1")
    notFound();
  return <ReportFixture />;
}
