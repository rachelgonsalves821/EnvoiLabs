"use client";

import { RecordAnswerResponseSchema } from "@envoi-labs/contracts";
import { Button } from "@envoi-labs/ui";
import { useRef, useState, type SubmitEvent } from "react";
import { interviewRequest } from "../../interview-request";
import { interviewCopy as copy } from "./copy";

export function ProbeTextAnswer({ sessionId, turnId, probeId, shown, onSaved }: {
  sessionId: string; turnId: string; probeId: string; shown: boolean; onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ id: string; text: string } | null>(null);

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !shown) return;
    const text = value.trim();
    if (!text) { setError(copy.answerNeeded); return; }
    if (attempt.current?.text !== text) attempt.current = { id: crypto.randomUUID(), text };
    setPending(true);
    setError("");
    const result = await interviewRequest("/api/respondent/probes/answer", {
      sessionId, turnId, probeId, answerId: attempt.current.id, text,
    });
    const answer = RecordAnswerResponseSchema.safeParse(result.data);
    if (answer.success && answer.data.answer.id === attempt.current.id
      && answer.data.answer.sessionId === sessionId
      && answer.data.answer.probeId === probeId) { onSaved(); return; }
    setPending(false);
    setError(result.status === 401 ? copy.sessionExpired
      : result.status === 404 || result.status === 409 ? copy.answerConflict : copy.saveFailed);
  }

  return <form className="respondent-interview-form" onSubmit={(event) => void save(event)} noValidate>
    <div className="ev-field">
      <label htmlFor="probe-typed-answer">{copy.answerLabel}</label>
      <textarea id="probe-typed-answer" rows={5} value={value} disabled={!shown || pending} required
        onChange={(event) => { setValue(event.currentTarget.value); setError(""); }} />
    </div>
    <Button type="submit" variant="pulse" disabled={!shown || pending}>{copy.saveAnswer}</Button>
    {!shown && <p role="status">{copy.preparingFollowup}</p>}
    {pending && <p role="status">{copy.savingAnswer}</p>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
