"use client";

import { useEffect, useState, type FormEvent } from "react";
import { authCopy as copy } from "../copy";
import { AuthRequestError, isRecord, mfaRequest } from "../_auth/auth-api";
import styles from "../_auth/auth.module.css";

type Step =
  | { kind: "loading" | "retry" | "enroll" }
  | { kind: "challenge"; factorId: string; secret?: string };

export function MfaForm() {
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function checkSession() {
      try {
        const data = await mfaRequest({ action: "status" }, controller.signal);
        if (controller.signal.aborted) return;
        if (!isRecord(data)) throw new Error("Invalid MFA status.");
        if (data.state === "verified") {
          window.location.replace("/app");
        } else if (data.state === "challenge" && typeof data.factorId === "string") {
          setStep({ kind: "challenge", factorId: data.factorId });
        } else if (data.state === "enroll") {
          setStep({ kind: "enroll" });
        } else {
          throw new Error("Invalid MFA status.");
        }
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof AuthRequestError && failure.status === 401) {
          window.location.replace("/app/sign-in");
        } else {
          setStep({ kind: "retry" });
          setError(copy.sessionFailed);
        }
      }
    }
    void checkSession();
    return () => controller.abort();
  }, [attempt]);

  async function enroll() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const data = await mfaRequest({ action: "enroll" });
      if (!isRecord(data) || typeof data.factorId !== "string" || typeof data.secret !== "string") {
        throw new Error("Invalid MFA enrollment.");
      }
      setStep({ kind: "challenge", factorId: data.factorId, secret: data.secret });
    } catch (failure) {
      if (failure instanceof AuthRequestError && failure.status === 401) {
        window.location.replace("/app/sign-in?error=session");
        return;
      }
      setError(copy.setupFailed);
    } finally {
      setPending(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || step.kind !== "challenge") return;
    setPending(true);
    setError("");
    try {
      const { factorId } = step;
      const data = await mfaRequest({ action: "challenge", factorId });
      if (!isRecord(data) || typeof data.challengeId !== "string") throw new Error("Invalid MFA challenge.");
      await mfaRequest({ action: "verify", factorId, challengeId: data.challengeId, code });
      window.location.replace("/app");
    } catch (failure) {
      // The provider returns 401 for both an incorrect code and an expired session.
      // Check the session before deciding whether the researcher needs a new link.
      if (failure instanceof AuthRequestError && failure.status === 401) {
        try {
          await mfaRequest({ action: "status" });
        } catch (statusFailure) {
          if (statusFailure instanceof AuthRequestError && statusFailure.status === 401) {
            window.location.replace("/app/sign-in?error=session");
            return;
          }
        }
      }
      setError(copy.verificationFailed);
      setCode("");
      setPending(false);
    }
  }

  const setup = step.kind === "enroll" || (step.kind === "challenge" && Boolean(step.secret));
  return (
    <>
      <h1>{setup ? copy.mfaSetup : copy.mfa}</h1>
      {step.kind === "loading" && <p role="status">{copy.checkingSession}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {step.kind === "retry" && <button type="button" onClick={() => {
        setStep({ kind: "loading" });
        setError("");
        setAttempt((previous) => previous + 1);
      }}>{copy.tryAgain}</button>}
      {step.kind === "enroll" && <button type="button" onClick={enroll} disabled={pending}>
        {pending ? copy.working : copy.startSetup}
      </button>}
      {step.kind === "challenge" && <>
        <p className={styles.hint}>{step.secret ? copy.setupHint : copy.mfaHint}</p>
        {step.secret && <p><span className={styles.keyLabel}>{copy.setupKey}</span>
          <code className={styles.key}>{step.secret}</code></p>}
        <form className={styles.form} method="post" onSubmit={verify} aria-busy={pending}>
          <label htmlFor="researcher-otp">{copy.code}</label>
          <input id="researcher-otp" name="code" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} required />
          <button type="submit" disabled={pending}>{pending ? copy.working : copy.verify}</button>
        </form>
      </>}
      <div className={styles.secondary}><a href="/app/sign-in">{copy.restart}</a></div>
    </>
  );
}
