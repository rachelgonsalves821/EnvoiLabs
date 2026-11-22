"use client";

import { StudyTrackingResponseSchema } from "@envoi-labs/contracts";
import { Chip } from "@envoi-labs/ui";
import { useEffect, useState } from "react";
import { stateLabels, trackingCopy as copy } from "./copy";
import styles from "./tracking.module.css";

type Tracking = ReturnType<typeof StudyTrackingResponseSchema.parse>;
const utcFinish = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export function StudyTrackingPanel({ initial, targetCompletes }: { initial: Tracking; targetCompletes: number }) {
  const [snapshot, setSnapshot] = useState<Tracking | null>(initial);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const { studyId } = initial;

  useEffect(() => {
    const lifetime = new AbortController();
    let reading = false;
    let accessEnded = false;
    async function refresh() {
      if (document.hidden || reading || accessEnded) return;
      reading = true;
      try {
        const response = await fetch(`/api/researcher/studies/${studyId}/tracking`, {
          signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10_000)]),
        });
        if (response.status === 403 || response.status === 404) {
          accessEnded = true;
          setSnapshot(null);
          return;
        }
        if (!response.ok) throw new Error("Tracking refresh failed");
        const tracking = StudyTrackingResponseSchema.safeParse(await response.json());
        if (!tracking.success || tracking.data.studyId !== studyId) throw new Error("Tracking refresh was invalid");
        if (!lifetime.signal.aborted) {
          setSnapshot(tracking.data);
          setRefreshFailed(false);
        }
      } catch {
        if (!lifetime.signal.aborted) setRefreshFailed(true);
      } finally {
        reading = false;
      }
    }

    const interval = window.setInterval(() => { void refresh(); }, 5_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      lifetime.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [studyId]);

  if (!snapshot) return <p role="status">{copy.accessEnded}</p>;
  return (
    <section className={styles.panel} aria-labelledby="tracking-heading">
      <div className={styles.heading}>
        <h2 id="tracking-heading">{copy.title}</h2>
        <Chip tone={snapshot.state === "fielding" ? "tide" : "neutral"}>{stateLabels[snapshot.state]}</Chip>
      </div>
      <p className={styles.progress} aria-live="polite">
        <strong>{snapshot.completed} of {targetCompletes}</strong> {copy.completes}
      </p>
      <dl className={styles.counts}>
        {copy.counts.map(([key, label]) => (
          <div key={key}><dt>{label}</dt><dd>{snapshot[key]}</dd></div>
        ))}
      </dl>
      {snapshot.projectedFinish && (
        <p>{copy.estimatedFinish} <time dateTime={snapshot.projectedFinish}>{utcFinish.format(new Date(snapshot.projectedFinish))} UTC</time></p>
      )}
      {refreshFailed && <p role="status" className={styles.status}>{copy.refreshFailed}</p>}
    </section>
  );
}
