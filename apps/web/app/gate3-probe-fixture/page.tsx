import { notFound } from "next/navigation";
import { ProbePaintFixture } from "./probe-paint-fixture";

/** Fictional browser harness; never serve this route from a production build. */
export default function Gate3ProbeFixturePage() {
  if (process.env.NODE_ENV !== "development" || process.env.ENVOI_GATE3_PROBE_FIXTURE !== "1")
    notFound();
  return <ProbePaintFixture />;
}
