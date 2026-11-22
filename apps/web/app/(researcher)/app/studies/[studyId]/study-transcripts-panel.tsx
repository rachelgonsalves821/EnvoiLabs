"use client";

import { ResearcherTranscriptListSchema, type ResearcherTranscriptList } from "@envoi-labs/contracts";
import { useEffect, useState } from "react";
import { trackingCopy as copy } from "./copy";
import styles from "./tracking.module.css";

type TranscriptState = { kind: "loading" | "unavailable" } |
  { kind: "loaded"; items: ResearcherTranscriptList["transcripts"] };

export function StudyTranscriptsPanel({ studyId }: { studyId: string }) {
  const [snapshot, setSnapshot] = useState<TranscriptState>({ kind: "loading" });

  useEffect(() => {
    let active: AbortController | null = null;
    let accessEnded = false;

    async function refresh() {
      if (document.hidden || active || accessEnded) return;
      const request = new AbortController();
      active = request;
      try {
        const response = await fetch(`/api/researcher/studies/${studyId}/transcripts`, {
          cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
        });
        if (active !== request) return;
        if (response.status === 403 || response.status === 404) accessEnded = true;
        if (!response.ok) throw new Error("Transcript refresh failed");
        const result = ResearcherTranscriptListSchema.safeParse(await response.json());
        if (!result.success || result.data.studyId !== studyId) throw new Error("Transcript refresh was invalid");
        if (active === request) setSnapshot({ kind: "loaded", items: result.data.transcripts });
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
    <section className={`${styles.panel} ${styles.transcripts}`} aria-labelledby="transcript-heading">
      <h2 id="transcript-heading">{copy.transcripts}</h2>
      {snapshot.kind === "loading" && <p role="status">{copy.transcriptsLoading}</p>}
      {snapshot.kind === "unavailable" && <p role="status">{copy.transcriptsUnavailable}</p>}
      {snapshot.kind === "loaded" && (snapshot.items.length === 0 ? (
        <p role="status">{copy.transcriptsEmpty}</p>
      ) : (
        <ul className={styles.transcriptList} role="list">
          {snapshot.items.map(({ id, redactedText }) => <li key={id}>{redactedText}</li>)}
        </ul>
      ))}
    </section>
  );
}
