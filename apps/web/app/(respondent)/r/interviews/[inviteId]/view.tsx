"use client";

import { SessionResponseSchema, SubmitSessionResponseSchema, type SessionResponse } from "@envoi-labs/contracts";
import { Button, Card, EarningsChip, ProgressTrack } from "@envoi-labs/ui";
import { useEffect, useRef, useState } from "react";
import { interviewRequest } from "../../interview-request";
import { formatReward } from "../../reward";
import { interviewCopy as copy } from "./copy";
import { AnswerComposer } from "./answer-composer";
import { browserProbeClockStamp } from "./browser-probe-clock";
import { ProbeTextAnswer } from "./probe-text-answer";
import { ProbeRenderBoundary } from "./probe-render-boundary";
import { currentPrompt } from "./current-prompt";

type InterviewState = { kind: "opening" | "submitted" } | { kind: "open"; session: SessionResponse }
  | { kind: "unavailable" | "closed" | "sessionExpired" };

export function InterviewView({ inviteId, canRecord }: { inviteId: string; canRecord: boolean }) {
  const [state, setState] = useState<InterviewState>({ kind: "opening" });
  const [attempt, setAttempt] = useState(0);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [confirmedProbeId, setConfirmedProbeId] = useState<string | null>(null);
  const submitting = useRef(false);
  const prompt = useRef<HTMLHeadingElement>(null);
  const closedAlert = useRef<HTMLParagraphElement>(null);
  const currentState = useRef(state.kind);
  currentState.current = state.kind;
  const displayed = state.kind === "open" ? currentPrompt(state.session) : null;
  const promptIdentity = state.kind === "submitted" ? "submitted" : state.kind === "open" && displayed
    ? `${state.session.sessionId}:${displayed.kind}:${"id" in displayed ? displayed.id : ""}` : null;

  useEffect(() => {
    const recheck = () => {
      if (currentState.current !== "open" && currentState.current !== "opening") return;
      setConfirmedProbeId(null);
      setState({ kind: "opening" });
      if (document.visibilityState === "visible") setAttempt((value) => value + 1);
    };
    document.addEventListener("visibilitychange", recheck);
    return () => document.removeEventListener("visibilitychange", recheck);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void interviewRequest("/api/respondent/sessions/start", { inviteId }, controller.signal).then((result) => {
      if (controller.signal.aborted || document.visibilityState !== "visible") return;
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
  }, [promptIdentity]);

  useEffect(() => {
    if (state.kind === "closed") closedAlert.current?.focus();
  }, [state.kind]);

  useEffect(() => {
    if (state.kind !== "open" || !state.session.probePending || state.session.currentProbe) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      setAttempt((value) => value + 1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (state.kind !== "open" || !state.session.currentProbe) return;
    const probe = state.session.currentProbe;
    const sessionId = state.session.sessionId;
    let active = true;
    let frame = 0;
    let paintedFrame = 0;
    const renderFailed = () => {
      if (!active) return;
      recordRenderFailure(sessionId, probe.turnId, probe.probeId, () => active);
    };
    try {
      frame = requestAnimationFrame(() => {
        try {
          paintedFrame = requestAnimationFrame(() => {
            if (!active) return;
            try {
              const rendered = browserProbeClockStamp();
              void interviewRequest("/api/respondent/probes/shown", {
                sessionId, turnId: probe.turnId, probeId: probe.probeId,
                browserClockOriginId: rendered.browserClockOriginId,
                browserRenderedAtMs: rendered.atMs,
              }).then((result) => {
                if (!active) return;
                if (result.status === 200) setConfirmedProbeId(probe.probeId);
                else retry();
              });
            } catch { renderFailed(); }
          });
        } catch { renderFailed(); }
      });
    } catch { renderFailed(); }
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(paintedFrame);
    };
  }, [state]);

  function retry() {
    setConfirmedProbeId(null);
    setState({ kind: "opening" });
    setAttempt((value) => value + 1);
  }

  function recordRenderFailure(sessionId: string, turnId: string, probeId: string,
    isCurrent = () => true) {
    void interviewRequest("/api/respondent/probes/render-error", {
      sessionId, turnId, probeId,
    }).then((result) => {
      if (!isCurrent()) return;
      if (result.status === 200 && result.data && typeof result.data === "object"
        && "outcome" in result.data && result.data.outcome !== "shown") retry();
      else setState({ kind: "unavailable" });
    });
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
          <h1 ref={prompt} tabIndex={-1}>{displayed?.kind === "pending"
            ? copy.preparingFollowup : displayed && "text" in displayed ? displayed.text : copy.complete}</h1>
          {state.session.currentProbe
            ? <ProbeRenderBoundary key={state.session.currentProbe.probeId}
                onError={() => recordRenderFailure(state.session.sessionId,
                  state.session.currentProbe!.turnId, state.session.currentProbe!.probeId)}>
                <ProbeTextAnswer sessionId={state.session.sessionId}
                  turnId={state.session.currentProbe.turnId}
                  probeId={state.session.currentProbe.probeId}
                  shown={confirmedProbeId === state.session.currentProbe.probeId} onSaved={retry} />
              </ProbeRenderBoundary>
            : state.session.probePending
            ? <p role="status">{copy.preparingFollowup}</p>
            : state.session.nextQuestion
            ? <AnswerComposer key={state.session.nextQuestion.id} canRecord={canRecord} sessionId={state.session.sessionId}
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
          <p ref={state.kind === "closed" ? closedAlert : undefined}
            tabIndex={state.kind === "closed" ? -1 : undefined}
            role={state.kind === "opening" ? "status" : "alert"}>{copy[state.kind]}</p>
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
