"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseScreeningSheet, type ScreeningSheet } from "../../../../../server/respondent/screening-sheet";
import { ScreeningVoiceAnswer } from "./screening-voice-answer";

export function ScreeningSheetView({ inviteId, voiceEnabled }: {
  inviteId: string; voiceEnabled: boolean;
}) {
  const [loaded, setLoaded] = useState<{ inviteId: string; sheet: ScreeningSheet } | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const retry = useRef<Record<string, { text: string; key: string }>>({});
  const currentInvite = useRef(inviteId);
  currentInvite.current = inviteId;
  const readNumber = useRef(0);
  const currentRead = useRef<AbortController | null>(null);
  const sheet = loaded?.inviteId === inviteId ? loaded.sheet : null;
  const refresh = useCallback(async () => {
    const number = ++readNumber.current;
    currentRead.current?.abort();
    const controller = new AbortController();
    currentRead.current = controller;
    setLoaded(null);
    setText({});
    setError(false);
    try {
      const response = await fetch(`/api/respondent/screening/${encodeURIComponent(inviteId)}`, {
        credentials: "same-origin", cache: "no-store", signal: controller.signal,
      });
      const value = response.ok ? parseScreeningSheet(await response.json()) : null;
      if (controller.signal.aborted || number !== readNumber.current ||
        currentInvite.current !== inviteId) return;
      const currentSheet = value?.inviteId === inviteId ? value : null;
      setLoaded(currentSheet ? { inviteId, sheet: currentSheet } : null);
      setError(!currentSheet);
    } catch {
      if (!controller.signal.aborted && number === readNumber.current &&
        currentInvite.current === inviteId) {
        setLoaded(null);
        setError(true);
      }
    }
  }, [inviteId]);
  useEffect(() => {
    retry.current = {};
    void refresh();
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      ++readNumber.current;
      currentRead.current?.abort();
    };
  }, [refresh]);
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
      if (currentInvite.current !== inviteId) return;
      if (!response.ok) throw new Error("Screening answer unavailable");
      await refresh();
    } catch {
      if (currentInvite.current === inviteId) {
        setLoaded(null);
        setText({});
        setError(true);
      }
    }
    finally { setBusy(null); }
  }
  return <main className="respondent-studies">
    <a href="/r">Back to studies</a>
    <h1>Screening questions</h1>
    <p>Answer a few questions to check whether this study is a fit. An answer does not confirm a place.</p>
    {!sheet && !error && <p role="status">Loading questions…</p>}
    {error && <><p role="alert">We could not save or load your answer. Please try again.</p>
      <button type="button" className="ev-button" onClick={() => void refresh()}>Try again</button></>}
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
        {voiceEnabled && <ScreeningVoiceAnswer inviteId={inviteId}
          ruleId={question.ruleId} ruleVersion={question.ruleVersion}
          onSubmitted={() => void refresh()} />}
      </> : question.status === "pending_transcription" ? <p role="status">
        Your recording is being transcribed. Check back shortly.
      </p> : <p role="status">{question.status === "qualify" ? "This answer qualified." :
        question.status === "screen_out" ? "This study is not a fit." :
          "Your answer is awaiting review."}</p>}
    </section>)}
  </main>;
}
