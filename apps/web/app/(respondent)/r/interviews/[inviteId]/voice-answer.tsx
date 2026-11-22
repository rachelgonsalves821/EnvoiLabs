"use client";

import { Button, Echo } from "@envoi-labs/ui";
import { useEffect, useRef, useState } from "react";
import { interviewCopy as copy } from "./copy";
import { useVoiceCapture, type VoiceTake } from "./use-voice-capture";
import { voiceCopy as voice } from "./voice-copy";
import { confirmVoiceTake, stageVoiceTake, type VoiceTransfer } from "./voice-transfer";

function formatTimer(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VoiceAnswer({ sessionId, questionId, onUseText, onSaved }: {
  sessionId: string;
  questionId: string;
  onUseText: () => void;
  onSaved: () => void;
}) {
  const capture = useVoiceCapture();
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [upload, setUpload] = useState<{ answerId: string; status: number } | null>(null);
  const [uploadAttempt, setUploadAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const transfer = useRef<VoiceTransfer | null>(null);
  const review = useRef<HTMLParagraphElement>(null);

  useEffect(() => () => request.current?.abort(), []);
  const phase = capture.state.kind;
  const take = capture.state.kind === "review" ? capture.state.take : null;
  const uploadStatus = upload?.answerId === take?.answerId ? upload?.status : undefined;
  useEffect(() => {
    if (phase === "review") review.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (!take) return;
    const controller = new AbortController();
    if (transfer.current?.answerId !== take.answerId) transfer.current = { answerId: take.answerId };
    void stageVoiceTake({
      take, transfer: transfer.current, scope: { sessionId, guideQuestionId: questionId }, signal: controller.signal,
    }).then((status) => {
      if (!controller.signal.aborted) setUpload({ answerId: take.answerId, status });
    });
    return () => controller.abort();
  }, [take, sessionId, questionId, uploadAttempt]);

  async function save(take: VoiceTake) {
    if (request.current || uploadStatus !== 200 || transfer.current?.answerId !== take.answerId) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setSaveError("");
    const status = await confirmVoiceTake({
      take, transfer: transfer.current, scope: { sessionId, guideQuestionId: questionId }, signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    request.current = null;
    setPending(false);
    if (status === 200) onSaved();
    else if (status === 401) setSaveError(copy.sessionExpired);
    else if (status === 403 || status === 409) setSaveError(copy.answerConflict);
    else setSaveError(copy.saveFailed);
  }

  const current = capture.state;
  const recording = current.kind === "recording";
  const locked = current.kind === "permission" || current.kind === "stopping";
  const blocked = uploadStatus === 403 || uploadStatus === 409;
  const uploadFailed = uploadStatus !== undefined && uploadStatus !== 200;
  return (
    <div className="respondent-interview-form">
      {current.kind !== "review" && (
        <Button variant="ghost" className="respondent-record-button" aria-disabled={locked} aria-pressed={recording}
          aria-label={recording ? voice.stop : voice.start}
          onClick={() => recording ? capture.stop() : !locked && void capture.start()}>
          <Echo state={recording ? "listen" : "idle"} size={96} />
          <span>{recording ? voice.stop : voice.start}</span>
        </Button>
      )}
      {current.kind === "permission" && <p role="status">{voice.permission}</p>}
      {current.kind === "stopping" && <p role="status">{voice.stopping}</p>}
      {recording && (
        <p className="respondent-record-timer" role="status">
          {voice.recording} <span aria-hidden="true">{formatTimer(current.elapsedSeconds)}</span>
          {current.elapsedSeconds >= 150 && <span>{voice.limitWarning}</span>}
        </p>
      )}
      {current.kind === "review" && (
        <>
          <p ref={review} tabIndex={-1}>{voice.review}</p>
          <audio controls controlsList="nodownload" preload="metadata" src={current.take.localUrl} aria-label={voice.player} />
          {uploadFailed
            ? <Button variant="pulse" onClick={() => { setUpload(null); setUploadAttempt((value) => value + 1); }}>
              {voice.retryUpload}
            </Button>
            : <Button variant="pulse" aria-disabled={pending || uploadStatus !== 200}
              onClick={() => void save(current.take)}>{voice.save}</Button>}
          <Button variant="secondary" aria-disabled={pending} onClick={() => {
            if (request.current) return;
            capture.discard();
            setSaveError("");
            void capture.start();
          }}>{voice.again}</Button>
          {uploadStatus === undefined && <p role="status">{voice.staging}</p>}
          {uploadFailed && <p role="alert">{blocked ? copy.answerConflict : voice.uploadFailed}</p>}
        </>
      )}
      <Button variant="ghost" aria-disabled={pending} onClick={() => !request.current && onUseText()}>{voice.typed}</Button>
      {capture.error && <p role="alert">{voice[capture.error]}</p>}
      {saveError && <p role="alert">{saveError}</p>}
      {(blocked || saveError === copy.answerConflict) && (
        <a className="ev-button respondent-signup-link" href="/r/onboarding" data-variant="secondary">{copy.privacyChoices}</a>
      )}
      {pending && <p role="status">{voice.saving}</p>}
    </div>
  );
}
