import "@envoi-labs/ui/styles.css";
import { notFound } from "next/navigation";
import { EndpointReportFixture, ReportFixture } from "./report-fixture";

/** Fictional browser harness; never serve this route from a production build. */
export default async function Gate3ReportFixturePage({ searchParams }: {
  searchParams: Promise<{ endpoint?: string }>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.ENVOI_GATE3_REPORT_FIXTURE !== "1")
    notFound();
  const { endpoint } = await searchParams;
  return endpoint === "1" ? <EndpointReportFixture /> : <ReportFixture />;
}
