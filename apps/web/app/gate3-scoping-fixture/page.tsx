import "@envoi-labs/ui/styles.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FictionalScopingFixture } from "./scoping-fixture";
import { FictionalGuideFixture } from "./guide-fixture";

export const metadata: Metadata = { title: "Envoi Labs" };

/** Development-only fictional UI harness; never expose it from a production build. */
export default async function Gate3ScopingFixturePage({ searchParams }: {
  searchParams: Promise<{ guide?: string }>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.ENVOI_GATE3_SCOPING_FIXTURE !== "1")
    notFound();
  const { guide } = await searchParams;
  return guide === "1" ? <FictionalGuideFixture /> : <FictionalScopingFixture />;
}
