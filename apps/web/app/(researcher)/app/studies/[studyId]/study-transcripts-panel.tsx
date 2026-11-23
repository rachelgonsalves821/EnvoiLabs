"use client";

import {
  ResearcherTranscriptListSchema, ResearcherTranscriptListV2Schema,
  type ResearcherTranscriptList, type ResearcherTranscriptListV2,
} from "@envoi-labs/contracts";
import { useEffect, useId, useState } from "react";
import { trackingCopy as copy } from "./copy";
import styles from "./tracking.module.css";

type Transcripts = ResearcherTranscriptList | ResearcherTranscriptListV2;
type TranscriptState = { kind: "loading" | "unavailable" } | { kind: "loaded"; data: Transcripts };

function TranscriptList({ items }: { items: ResearcherTranscriptList["transcripts"] }) {
  return (
    <ul className={styles.transcriptList} role="list">
      {items.map(({ id, redactedText }) => <li key={id}>{redactedText}</li>)}
    </ul>
  );
}

function TranscriptContent({ data, headingId }: { data: Transcripts; headingId: string }) {
  const items = "respondents" in data ? data.respondents : data.transcripts;
  if (items.length === 0) return <p role="status">{copy.transcriptsEmpty}</p>;
  if ("transcripts" in data) return <TranscriptList items={data.transcripts} />;

  return (
    <div className={styles.transcriptGroups}>
      {data.respondents.map(({ number, student, transcripts }) => (
        <article key={number} className={styles.transcriptGroup} aria-labelledby={`${headingId}-${number}`}>
          <h3 id={`${headingId}-${number}`}>{copy.transcriptRespondent(number)}</h3>
          {student !== null && <p className={styles.transcriptDescriptor}>{student ? copy.student : copy.notStudent}</p>}
          <TranscriptList items={transcripts} />
        </article>
      ))}
    </div>
  );
}

export function StudyTranscriptsPanel({ studyId }: { studyId: string }) {
  const [snapshot, setSnapshot] = useState<TranscriptState>({ kind: "loading" });
  const headingId = useId();

  useEffect(() => {
    let active: AbortController | null = null;
    let accessEnded = false;

    async function refresh() {
      if (document.hidden || active || accessEnded) return;
      const request = new AbortController();
      active = request;
      try {
        const response = await fetch(`/api/researcher/studies/${studyId}/transcripts?version=2`, {
          cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
        });
        if (active !== request) return;
        if (response.status === 403 || response.status === 404) accessEnded = true;
        if (!response.ok) throw new Error("Transcript refresh failed");
        const payload: unknown = await response.json();
        const grouped = ResearcherTranscriptListV2Schema.safeParse(payload);
        const result = grouped.success ? grouped : ResearcherTranscriptListSchema.safeParse(payload);
        if (!result.success || result.data.studyId !== studyId) throw new Error("Transcript refresh was invalid");
        if (active === request) setSnapshot({ kind: "loaded", data: result.data });
      } catch {
        if (active === request) setSnapshot({ kind: "unavailable" });
      } finally {
        if (active === request) active = null;
      }
    }

    function abandonRequest() {
      active?.abort();
      active = null;
    }

    function checkVisibility() {
      if (document.hidden) {
        abandonRequest();
        if (!accessEnded) setSnapshot({ kind: "loading" });
      } else {
        void refresh();
      }
    }

    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 5_000);
    document.addEventListener("visibilitychange", checkVisibility);
    return () => {
      abandonRequest();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", checkVisibility);
    };
  }, [studyId]);

  return (
    <section className={`${styles.panel} ${styles.transcripts}`} aria-labelledby={headingId}>
      <h2 id={headingId}>{copy.transcripts}</h2>
      {snapshot.kind === "loading" && <p role="status">{copy.transcriptsLoading}</p>}
      {snapshot.kind === "unavailable" && <p role="status">{copy.transcriptsUnavailable}</p>}
      {snapshot.kind === "loaded" && <TranscriptContent data={snapshot.data} headingId={headingId} />}
    </section>
  );
}
