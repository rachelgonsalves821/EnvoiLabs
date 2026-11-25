import "@envoi-labs/ui/styles.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FictionalScopingFixture } from "./scoping-fixture";

export const metadata: Metadata = { title: "Envoi Labs" };

/** Development-only fictional UI harness; never expose it from a production build. */
export default function Gate3ScopingFixturePage() {
  if (process.env.NODE_ENV !== "development" || process.env.ENVOI_GATE3_SCOPING_FIXTURE !== "1")
    notFound();
  return <FictionalScopingFixture />;
}
