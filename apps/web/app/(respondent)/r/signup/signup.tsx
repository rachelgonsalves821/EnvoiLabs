"use client";

import { Button, Card, Field } from "@envoi-labs/ui";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { requestSignInLink } from "./auth-client";
import { signupCopy as copy } from "./copy";

type Step = "email" | "sent";
type FieldError = { field: "email" | "age"; message: string };

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RespondentSignup({ initialError }: { initialError: string }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [ageAttested, setAgeAttested] = useState(false);
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [requestError, setRequestError] = useState(initialError);
  const [announcement, setAnnouncement] = useState("");
  const requesting = useRef(false);
  const previousStep = useRef<Step>("email");
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

  async function sendLink(address: string) {
    if (requesting.current) return;
    requesting.current = true;
    setPending(true);
    clearFeedback();
    const result = await requestSignInLink({ email: address, ageAttested: true });
    requesting.current = false;
    setPending(false);

    if (result === "throttled") setRequestError(copy.throttled);
    if (result === "unavailable") setRequestError(copy.unavailable);
    if (result === "rejected") setRequestError(copy.startFailed);
    if (result !== "success") return;

    setEmail(address);
    if (step === "sent") setAnnouncement(copy.resent);
    else setStep("sent");
  }

  function submitEmail(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requesting.current) return;
    clearFeedback();
    const address = email.trim().toLowerCase();
    if (address.length > 254 || !emailPattern.test(address)) {
      return rejectField(event.currentTarget, "email", copy.emailError);
    }
    if (!ageAttested) return rejectField(event.currentTarget, "age", copy.ageError);
    void sendLink(address);
  }

  function editEmail() {
    if (requesting.current) return;
    clearFeedback();
    setStep("email");
  }

  const errorFor = (field: FieldError["field"]) => fieldError?.field === field ? fieldError.message : undefined;

  return (
    <Card className="respondent-welcome respondent-signup">
      <div>
        <h1 ref={heading} tabIndex={-1}>{step === "email" ? copy.title : copy.sentTitle}</h1>
        <p>{step === "email" ? copy.instruction : copy.sentInstruction}</p>
      </div>
      {step === "email" ? (
        <form onSubmit={submitEmail} noValidate>
          <Field
            id="signup-email"
            name="email"
            label={copy.email}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            required
            value={email}
            readOnly={pending}
            error={errorFor("email")}
            onChange={(event) => { setEmail(event.currentTarget.value); clearFeedback(); }}
          />
          <label className="respondent-age">
            <input
              type="checkbox"
              name="age"
              checked={ageAttested}
              required
              disabled={pending}
              aria-invalid={Boolean(errorFor("age"))}
              aria-describedby={errorFor("age") ? "signup-age-error" : undefined}
              onChange={(event) => { setAgeAttested(event.currentTarget.checked); clearFeedback(); }}
            />
            {copy.age}
          </label>
          {errorFor("age") && <span className="respondent-auth-error" id="signup-age-error" role="alert">{errorFor("age")}</span>}
          <Button type="submit" variant="pulse" aria-disabled={pending}>{copy.start}</Button>
        </form>
      ) : (
        <div className="respondent-auth-actions">
          <Button variant="secondary" aria-disabled={pending} onClick={() => void sendLink(email)}>{copy.resend}</Button>
          <Button variant="ghost" aria-disabled={pending} onClick={editEmail}>{copy.editEmail}</Button>
        </div>
      )}
      <div className="respondent-auth-status" role="status">{pending ? copy.sending : announcement}</div>
      {requestError && <div className="respondent-auth-error" role="alert">{requestError}</div>}
    </Card>
  );
}
