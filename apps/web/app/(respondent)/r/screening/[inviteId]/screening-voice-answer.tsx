"use client";

import { useEffect, useRef, useState } from "react";
import { useVoiceCapture } from "../../interviews/[inviteId]/use-voice-capture";
import { submitScreeningVoice, type ScreeningVoiceTransfer } from "./screening-voice-transfer";

export function ScreeningVoiceAnswer({ inviteId, ruleId, ruleVersion, onSubmitted }: {
  inviteId: string; ruleId: string; ruleVersion: number; onSubmitted: () => void;
}) {
  const capture = useVoiceCapture();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const transfer = useRef<ScreeningVoiceTransfer | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function save() {
    if (capture.state.kind !== "review" || request.current) return;
    const take = capture.state.take;
    if (transfer.current?.takeId !== take.answerId)
      transfer.current = { takeId: take.answerId };
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const status = await submitScreeningVoice({ inviteId, ruleId, ruleVersion,
        take, transfer: transfer.current, signal: controller.signal });
      if (!controller.signal.aborted) {
        if (status === 200) {
          capture.discard();
          onSubmitted();
        } else setError(status === 403 || status === 404 || status === 409
          ? "Your recording or privacy choice is no longer current. Reload the question before retrying."
          : "We could not save the recording. Try again.");
      }
    } catch {
      if (!controller.signal.aborted) setError("We could not save the recording. Try again.");
    } finally {
      request.current = null;
      setBusy(false);
    }
  }

  const phase = capture.state.kind;
  return <div className="respondent-interview-form">
    {phase === "review" ? <>
      <p>Review your answer before submitting it for transcription.</p>
      <audio controls controlsList="nodownload" preload="metadata"
        src={capture.state.take.localUrl} aria-label="Review your screening recording" />
      <button type="button" className="ev-button" disabled={busy}
        onClick={() => void save()}>{busy ? "Saving…" : "Submit recording"}</button>
      <button type="button" className="ev-button" disabled={busy}
        onClick={() => { transfer.current = null; capture.discard(); setError(""); }}>
        Record again
      </button>
    </> : <>
      <button type="button" className="ev-button respondent-record-button"
        aria-pressed={phase === "recording"}
        disabled={busy || phase === "permission" || phase === "stopping"}
        onClick={() => phase === "recording" ? capture.stop() : void capture.start()}>
        {phase === "recording" ? "Stop recording" : "Record an answer"}
      </button>
      {phase === "recording" && <p role="status">Recording: {capture.state.elapsedSeconds} seconds</p>}
      {phase === "permission" && <p role="status">Requesting microphone access…</p>}
      {phase === "stopping" && <p role="status">Finishing recording…</p>}
    </>}
    {capture.error && <p role="alert">Recording failed or is unavailable. You can type your answer.</p>}
    {error && <p role="alert">{error} <a href="/r/onboarding">Review privacy choices</a></p>}
  </div>;
}
