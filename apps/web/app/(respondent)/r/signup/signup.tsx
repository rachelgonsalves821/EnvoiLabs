"use client";

import { Button, Card, Field } from "@envoi-labs/ui";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { normalizeUsPhone, respondentAuth } from "./auth-client";
import { signupCopy as copy } from "./copy";

type Step = "phone" | "code" | "complete";
type Request = "start" | "verify" | "resend";
type FieldError = { field: "phone" | "age" | "code"; message: string };

export function RespondentSignup() {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [ageAttested, setAgeAttested] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<Request | null>(null);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [requestError, setRequestError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const requesting = useRef(false);
  const previousStep = useRef<Step>("phone");
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (previousStep.current !== step) heading.current?.focus();
    previousStep.current = step;
  }, [step]);

  function clearFeedback() {
    setFieldError(null);
    setRequestError("");
    setAnnouncement("");
  }

  function rejectField(form: HTMLFormElement, field: FieldError["field"], message: string) {
    setFieldError({ field, message });
    const input = form.elements.namedItem(field);
    if (input instanceof HTMLInputElement) input.focus();
  }

  async function request(action: Request, normalized: string, verificationCode = "") {
    if (requesting.current) return;
    requesting.current = true;
    setPending(action);
    clearFeedback();
    const payload = { phone: normalized, ageAttested: true } as const;
    const result = action === "verify"
      ? await respondentAuth.verify({ ...payload, code: verificationCode })
      : await respondentAuth.start(payload);
    requesting.current = false;
    setPending(null);

    if (result === "throttled") setRequestError(copy.throttled);
    if (result === "unavailable") setRequestError(copy.unavailable);
    if (result === "rejected") setRequestError(action === "verify" ? copy.verifyFailed : copy.startFailed);
    if (result !== "success") return;

    setCode("");
    if (action === "resend") {
      setAnnouncement(copy.resent);
    } else if (action === "start") {
      setPhone(normalized);
      setStep("code");
    } else {
      setPhone("");
      setAgeAttested(false);
      setStep("complete");
    }
  }

  function submitPhone(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requesting.current) return;
    clearFeedback();
    const normalized = normalizeUsPhone(phone);
    if (!normalized) return rejectField(event.currentTarget, "phone", copy.phoneError);
    if (!ageAttested) return rejectField(event.currentTarget, "age", copy.ageError);
    void request("start", normalized);
  }

  function submitCode(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requesting.current) return;
    clearFeedback();
    const verificationCode = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(verificationCode)) return rejectField(event.currentTarget, "code", copy.codeError);
    void request("verify", phone, verificationCode);
  }

  function editPhone() {
    clearFeedback();
    setCode("");
    setStep("phone");
  }

  const title = step === "phone" ? copy.title : step === "code" ? copy.verifyTitle : copy.completeTitle;
  const status = pending === "verify" ? copy.verifying : pending ? copy.sending : announcement;
  const errorFor = (field: FieldError["field"]) => fieldError?.field === field ? fieldError.message : undefined;

  return (
    <Card className="respondent-welcome respondent-signup">
      <div>
        <h1 ref={heading} tabIndex={-1}>{title}</h1>
        {step !== "complete" && <p>{step === "phone" ? copy.instruction : copy.verifyInstruction}</p>}
      </div>
      {step === "phone" && (
        <form onSubmit={submitPhone} noValidate>
          <Field
            id="signup-phone"
            name="phone"
            label={copy.phone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            value={phone}
            readOnly={pending !== null}
            error={errorFor("phone")}
            onChange={(event) => { setPhone(event.currentTarget.value); clearFeedback(); }}
          />
          <label className="respondent-age">
            <input
              type="checkbox"
              name="age"
              checked={ageAttested}
              required
              disabled={pending !== null}
              aria-invalid={Boolean(errorFor("age"))}
              aria-describedby={errorFor("age") ? "signup-age-error" : undefined}
              onChange={(event) => { setAgeAttested(event.currentTarget.checked); clearFeedback(); }}
            />
            {copy.age}
          </label>
          {errorFor("age") && <span className="respondent-auth-error" id="signup-age-error" role="alert">{errorFor("age")}</span>}
          <Button type="submit" variant="pulse" disabled={pending !== null}>{copy.start}</Button>
        </form>
      )}
      {step === "code" && (
        <form onSubmit={submitCode} noValidate>
          <Field
            id="signup-code"
            name="code"
            label={copy.code}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            required
            value={code}
            readOnly={pending !== null}
            error={errorFor("code")}
            onChange={(event) => { setCode(event.currentTarget.value); clearFeedback(); }}
          />
          <Button type="submit" variant="pulse" disabled={pending !== null}>{copy.verify}</Button>
          <div className="respondent-auth-actions">
            <Button variant="ghost" disabled={pending !== null} onClick={() => void request("resend", phone)}>{copy.resend}</Button>
            <Button variant="ghost" disabled={pending !== null} onClick={editPhone}>{copy.editPhone}</Button>
          </div>
        </form>
      )}
      {step === "complete" && <a className="ev-button respondent-signup-link" href="/r">{copy.completeAction}</a>}
      {step !== "complete" && <div className="respondent-auth-status" role="status">{status}</div>}
      {requestError && <div className="respondent-auth-error" role="alert">{requestError}</div>}
    </Card>
  );
}
