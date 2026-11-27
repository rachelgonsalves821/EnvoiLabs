"use client";

import { useEffect, useId, useRef, useState } from "react";
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

function saveCsv(content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "envoi-labs-themes-and-quotes.csv";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Pass a controller backed by the current qualified reader; do not mount with raw tables. */
export function StudyReportPanel({ controller, save = saveCsv }: {
  controller: ReportPanelController; save?: (content: string) => void;
}) {
  const currentController = useRef(controller);
  currentController.current = controller;
  const [view, setView] = useState(() => ({ controller, state: controller.getState() }));
  const state: State = view.controller === controller
    ? view.state : { kind: "loading", canExport: false };
  const [notice, setNotice] = useState(() => ({ controller, visible: false }));
  const exportNotice = notice.controller === controller && notice.visible;
  const setExportNotice = (visible: boolean) => setNotice({ controller, visible });
  const headingId = useId();

  useEffect(() => {
    const unsubscribe = controller.subscribe((next) => {
      if (currentController.current === controller) setView({ controller, state: next });
    });
    void controller.refresh();
    const refresh = () => { if (!document.hidden) { setExportNotice(false); void controller.refresh(); } };
    document.addEventListener("visibilitychange", refresh);
    return () => { unsubscribe(); document.removeEventListener("visibilitychange", refresh); };
  }, [controller]);

  async function download() {
    setExportNotice(false);
    const payload = await controller.requestExport();
    if (currentController.current !== controller) return;
    if (!payload) {
      // The withheld state already explains a revoked report. A newer ready
      // version needs review before its first download.
      if (controller.getState().kind === "ready") setExportNotice(true);
      return;
    }
    save(payload);
  }

  return (
    <section className={`${styles.panel} ${styles.report}`} aria-labelledby={headingId}
      aria-busy={state.kind === "loading"}>
      <h2 id={headingId}>Research report</h2>
      {state.kind === "loading" && <p role="status">Checking the current report…</p>}
      {state.kind === "withheld" && (
        <p role="status">The report is currently unavailable.</p>
      )}
      {state.kind === "ready" && (
        <>
          <p className={styles.reportAnnouncement} role="status">Current report ready.</p>
          <p>Directional qualitative</p>
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
        </>
      )}
      <button type="button" aria-disabled={state.kind === "loading"
        || (state.kind === "ready" && !state.canExport)} onClick={() => {
          if (state.kind === "withheld") {
            setExportNotice(false);
            void controller.refresh();
          } else if (state.kind === "ready" && state.canExport) void download();
        }}>
        {state.kind === "withheld" ? "Check again"
          : state.kind === "ready" && state.canExport
            ? "Download themes and quotes CSV" : "Checking report…"}
      </button>
      {exportNotice && state.kind === "ready" &&
        <p role="status">The report changed. Review the current version before downloading.</p>}
    </section>
  );
}
