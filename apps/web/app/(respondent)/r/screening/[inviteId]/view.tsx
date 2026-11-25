"use client";

import { useEffect, useRef, useState } from "react";
import { parseScreeningSheet, type ScreeningSheet } from "../../../../../server/respondent/screening-sheet";

export function ScreeningSheetView({ inviteId }: { inviteId: string }) {
  const [sheet, setSheet] = useState<ScreeningSheet | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const retry = useRef<Record<string, { text: string; key: string }>>({});
  useEffect(() => {
    let live = true;
    fetch(`/api/respondent/screening/${encodeURIComponent(inviteId)}`, {
      credentials: "same-origin", cache: "no-store",
    }).then(async (response) => response.ok ? parseScreeningSheet(await response.json()) : null)
      .then((value) => { if (live) { setSheet(value); setError(!value); } })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [inviteId]);
  async function submit(ruleId: string, ruleVersion: number) {
    const answer = text[ruleId]?.trim() ?? "";
    if (!answer || busy) return;
    const prior = retry.current[ruleId];
    const key = prior?.text === answer ? prior.key : `gate2-screen:${crypto.randomUUID()}`;
    retry.current[ruleId] = { text: answer, key };
    setBusy(ruleId);
    setError(false);
    try {
      const response = await fetch(`/api/respondent/screening/${encodeURIComponent(inviteId)}`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ruleId, ruleVersion, text: answer, key }),
      });
      if (!response.ok) throw new Error("Screening answer unavailable");
      setSheet((current) => current && { ...current, questions: current.questions.map((item) =>
        item.ruleId === ruleId ? { ...item, status: "pending_review" } : item) });
    } catch { setError(true); }
    finally { setBusy(null); }
  }
  return <main className="respondent-studies">
    <a href="/r">Back to studies</a>
    <h1>Screening questions</h1>
    <p>Answer a few questions to check whether this study is a fit. An answer does not confirm a place.</p>
    {!sheet && !error && <p role="status">Loading questions…</p>}
    {error && <p role="alert">We could not save or load your answer. Please try again.</p>}
    {sheet?.questions.length === 0 && <p role="status">No approved questions are available yet.</p>}
    {sheet?.questions.map((question, index) => <section key={question.ruleId}
      className="respondent-invite">
      <h2>Question {index + 1} of {sheet.questions.length}</h2>
      <p>{question.question}</p>
      {(question.status === "unanswered" || question.status === "clarify") ? <>
        {question.status === "clarify" && <p role="status">Please add detail so we can review your answer.</p>}
        <label htmlFor={`screen-${question.ruleId}`}>Your answer</label>
        <textarea id={`screen-${question.ruleId}`} maxLength={2000}
          value={text[question.ruleId] ?? ""}
          onChange={(event) => setText((current) => ({ ...current,
            [question.ruleId]: event.target.value }))} />
        <button type="button" className="ev-button" disabled={busy !== null ||
          !(text[question.ruleId]?.trim())}
        onClick={() => void submit(question.ruleId, question.ruleVersion)}>
          {busy === question.ruleId ? "Saving…" : "Submit answer"}
        </button>
      </> : <p role="status">{question.status === "qualify" ? "This answer qualified." :
        question.status === "screen_out" ? "This study is not a fit." :
          "Your answer is awaiting review."}</p>}
    </section>)}
  </main>;
}
