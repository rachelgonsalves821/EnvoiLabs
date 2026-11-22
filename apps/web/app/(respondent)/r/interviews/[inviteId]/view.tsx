"use client";

import { SessionResponseSchema, SubmitSessionResponseSchema, type SessionResponse } from "@envoi-labs/contracts";
import { Button, Card, EarningsChip, ProgressTrack } from "@envoi-labs/ui";
import { useEffect, useRef, useState } from "react";
import { interviewRequest } from "../../interview-request";
import { formatReward } from "../../reward";
import { interviewCopy as copy } from "./copy";
import { TextAnswer } from "./text-answer";

type InterviewState = { kind: "opening" | "submitted" } | { kind: "open"; session: SessionResponse }
  | { kind: "unavailable" | "closed" | "sessionExpired" };

export function InterviewView({ inviteId }: { inviteId: string }) {
  const [state, setState] = useState<InterviewState>({ kind: "opening" });
  const [attempt, setAttempt] = useState(0);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submitting = useRef(false);
  const prompt = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void interviewRequest("/api/respondent/sessions/start", { inviteId }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      const session = SessionResponseSchema.safeParse(result.data);
      if (session.success && session.data.sessionId === session.data.progress.sessionId) {
        setState({ kind: "open", session: session.data });
      } else if (result.status === 401) {
        setState({ kind: "sessionExpired" });
      } else {
        setState({ kind: result.status === 404 || result.status === 409 ? "closed" : "unavailable" });
      }
    });
    return () => controller.abort();
  }, [inviteId, attempt]);

  useEffect(() => {
    if (state.kind === "open" || state.kind === "submitted") prompt.current?.focus();
  }, [state]);

  function retry() {
    setState({ kind: "opening" });
    setAttempt((value) => value + 1);
  }

  async function submit(sessionId: string) {
    if (submitting.current) return;
    submitting.current = true;
    setPendingSubmit(true);
    setSubmitError("");
    const response = await interviewRequest("/api/respondent/sessions/submit", { sessionId });
    const submitted = SubmitSessionResponseSchema.safeParse(response.data);
    submitting.current = false;
    setPendingSubmit(false);
    if (submitted.success && submitted.data.sessionId === sessionId) setState({ kind: "submitted" });
    else setSubmitError(response.status === 401 ? copy.sessionExpired : copy.submitFailed);
  }

  return (
    <Card className="respondent-welcome">
      {state.kind === "open" ? (
        <>
          <div className="respondent-invite-facts">
            <ProgressTrack current={state.session.progress.currentQuestion} total={state.session.progress.coreQuestionCount} />
            <EarningsChip amount={formatReward(state.session.progress.rewardCents)} />
          </div>
          <h1 ref={prompt} tabIndex={-1}>{state.session.nextQuestion?.text ?? copy.complete}</h1>
          {state.session.nextQuestion
            ? <TextAnswer key={state.session.nextQuestion.id} sessionId={state.session.sessionId}
              questionId={state.session.nextQuestion.id} onSaved={retry} />
            : <Button variant="pulse" aria-disabled={pendingSubmit} onClick={() => void submit(state.session.sessionId)}>
              {copy.submit}
            </Button>}
        </>
      ) : state.kind === "submitted" ? (
        <div>
          <h1 ref={prompt} tabIndex={-1}>{copy.submitted}</h1>
          <p>{copy.qualityHold}</p>
        </div>
      ) : (
        <div>
          <h1>{copy.title}</h1>
          <p role={state.kind === "opening" ? "status" : "alert"}>{copy[state.kind]}</p>
        </div>
      )}
      {pendingSubmit && <p role="status">{copy.submitting}</p>}
      {submitError && <p role="alert">{submitError}</p>}
      {state.kind === "unavailable" && <Button variant="pulse" onClick={retry}>{copy.retry}</Button>}
      {state.kind === "sessionExpired" && (
        <a className="ev-button respondent-signup-link" href="/r/signup" data-variant="pulse">{copy.signIn}</a>
      )}
      <a className="ev-button respondent-signup-link" href="/r" data-variant="ghost">{copy.home}</a>
    </Card>
  );
}
