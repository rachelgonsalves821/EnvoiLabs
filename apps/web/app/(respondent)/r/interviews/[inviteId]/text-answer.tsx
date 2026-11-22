"use client";

import { RecordAnswerResponseSchema } from "@envoi-labs/contracts";
import { Button } from "@envoi-labs/ui";
import { useRef, useState, type SubmitEvent } from "react";
import { interviewRequest } from "../../interview-request";
import { interviewCopy as copy } from "./copy";

export function TextAnswer({ sessionId, questionId, onSaved }: {
  sessionId: string;
  questionId: string;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const lastAttempt = useRef<{ id: string; text: string } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const answer = text.trim();
    if (!answer) {
      setError(copy.answerNeeded);
      input.current?.focus();
      return;
    }
    sending.current = true;
    setPending(true);
    setError("");
    if (lastAttempt.current?.text !== answer) lastAttempt.current = { id: crypto.randomUUID(), text: answer };
    const answerId = lastAttempt.current.id;
    const response = await interviewRequest("/api/respondent/answers/record", {
      kind: "text", answerId, sessionId, guideQuestionId: questionId, text: answer,
    });
    const recorded = RecordAnswerResponseSchema.safeParse(response.data);
    if (recorded.success && recorded.data.answer.id === answerId &&
      recorded.data.answer.sessionId === sessionId && recorded.data.answer.guideQuestionId === questionId) {
      onSaved();
      return;
    }
    sending.current = false;
    setPending(false);
    if (response.status === 401) setError(copy.sessionExpired);
    else if (response.status === 409) setError(copy.answerConflict);
    else setError(copy.saveFailed);
  }

  return (
    <form className="respondent-interview-form" onSubmit={(event) => void save(event)} noValidate>
      <div className="ev-field">
        <label htmlFor="interview-typed-answer">{copy.answerLabel}</label>
        <textarea id="interview-typed-answer" ref={input} rows={5} value={text} readOnly={pending} required
          aria-invalid={error === copy.answerNeeded ? true : undefined}
          aria-describedby={error ? "interview-typed-error" : undefined}
          onChange={(event) => { setText(event.currentTarget.value); setError(""); }} />
      </div>
      <Button type="submit" variant="pulse" aria-disabled={pending}>{copy.saveAnswer}</Button>
      {pending && <p role="status">{copy.savingAnswer}</p>}
      {error && <p id="interview-typed-error" role="alert">{error}</p>}
      {error === copy.answerConflict && (
        <a className="ev-button respondent-signup-link" href="/r/onboarding" data-variant="secondary">{copy.privacyChoices}</a>
      )}
    </form>
  );
}
