import "@envoi-labs/ui/styles.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EndpointReportFixture, ReportFixture, TranscriptFixture } from "./report-fixture";

export const metadata: Metadata = { title: "Envoi Labs" };

/** Fictional browser harness; never serve this route from a production build. */
export default async function Gate3ReportFixturePage({ searchParams }: {
  searchParams: Promise<{ endpoint?: string; transcript?: string }>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.ENVOI_GATE3_REPORT_FIXTURE !== "1")
    notFound();
  const { endpoint, transcript } = await searchParams;
  if (transcript === "1") return <TranscriptFixture />;
  return endpoint === "1" ? <EndpointReportFixture /> : <ReportFixture />;
}
