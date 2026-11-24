"use client";

import { useEffect, useId, useState } from "react";
import styles from "./tracking.module.css";

type Evidence = { exactText: string; transcriptId: string };
type Theme = { claim: string; count: number; total: number;
  confidence: "high" | "medium" | "low";
  supportingQuotes: readonly Evidence[]; contradictingQuotes: readonly Evidence[] };
type Report = { reportId: string; summary: { executiveAnswer: string;
  themes: readonly Theme[]; hypotheses: readonly { hypothesis: string; result: string }[] } };
type State = { kind: "loading" | "withheld"; canExport: false } |
  { kind: "ready"; canExport: boolean; report: Report };
export interface ReportPanelController {
  getState(): State;
  subscribe(listener: (state: State) => void): () => void;
  refresh(): Promise<State>;
  requestExport(): Promise<string | null>;
}

function saveJson(content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "envoi-labs-report.json";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Pass a controller backed by the current qualified reader; do not mount with raw tables. */
export function StudyReportPanel({ controller, save = saveJson }: {
  controller: ReportPanelController; save?: (content: string) => void;
}) {
  const [state, setState] = useState<State>(() => controller.getState());
  const [exportError, setExportError] = useState(false);
  const headingId = useId();

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    void controller.refresh();
    const refresh = () => { if (!document.hidden) void controller.refresh(); };
    document.addEventListener("visibilitychange", refresh);
    return () => { unsubscribe(); document.removeEventListener("visibilitychange", refresh); };
  }, [controller]);

  async function download() {
    setExportError(false);
    const payload = await controller.requestExport();
    if (!payload) { setExportError(true); return; }
    save(payload);
  }

  return (
    <section className={`${styles.panel} ${styles.report}`} aria-labelledby={headingId}>
      <h2 id={headingId}>Research report</h2>
      {state.kind === "loading" && <p role="status">Checking the current report…</p>}
      {state.kind === "withheld" && (
        <><p role="status">The report is currently unavailable.</p>
          <button type="button" onClick={() => void controller.refresh()}>Check again</button></>
      )}
      {state.kind === "ready" && (
        <>
          <p className={styles.reportAnswer}>{state.report.summary.executiveAnswer}</p>
          <div className={styles.reportThemes}>
            {state.report.summary.themes.map((theme, index) => (
              <article key={`${state.report.reportId}-${index}`} className={styles.reportTheme}>
                <h3>{theme.claim}</h3>
                <p>{theme.count} of {theme.total} respondents · {theme.confidence} confidence</p>
                <h4>Supporting evidence</h4>
                <ul>{theme.supportingQuotes.map((quote, position) =>
                  <li key={`${quote.transcriptId}-${position}`}><blockquote>{quote.exactText}</blockquote></li>)}</ul>
                {theme.contradictingQuotes.length > 0 && <>
                  <h4>Contradicting evidence</h4>
                  <ul>{theme.contradictingQuotes.map((quote, position) =>
                    <li key={`${quote.transcriptId}-${position}`}><blockquote>{quote.exactText}</blockquote></li>)}</ul>
                </>}
              </article>
            ))}
          </div>
          {state.report.summary.hypotheses.length > 0 && <>
            <h3>Hypotheses</h3>
            <ul>{state.report.summary.hypotheses.map((item, index) =>
              <li key={index}>{item.hypothesis} · {item.result}</li>)}</ul>
          </>}
          <button type="button" disabled={!state.canExport} onClick={() => void download()}>
            {state.canExport ? "Download report" : "Checking report…"}
          </button>
        </>
      )}
      {exportError && <p role="status">The report changed. Review the current version before downloading.</p>}
    </section>
  );
}
