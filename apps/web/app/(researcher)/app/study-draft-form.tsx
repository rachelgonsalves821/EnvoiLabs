"use client";

import { CreateGate1StudyRequestSchema, StudyMutationResponseSchema, type StudyMutationResponse } from "@envoi-labs/contracts";
import { gate1CriterionChoices } from "@envoi-labs/services/study-draft-criteria";
import { Button, Field } from "@envoi-labs/ui";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { researcherCopy as copy } from "./copy";
import styles from "./researcher.module.css";

const criterionNumbers = [1, 2];
const questionNumbers = [1, 2, 3, 4];

export function StudyDraftForm({ launchEnabled }: { launchEnabled: boolean }) {
  const [saved, setSaved] = useState<{ title: string; study: StudyMutationResponse }>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ body: string; id: string } | null>(null);
  const inFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(event.currentTarget);
    const draft = CreateGate1StudyRequestSchema.safeParse({
      title: form.get("title")?.toString().trim(),
      targetCompletes: Number(form.get("target")),
      criteria: criterionNumbers.map((number) => ({
        kind: form.get(`kind-${number}`),
        text: form.get(`criterion-${number}`),
      })),
      coreQuestions: questionNumbers.map((number) => form.get(`question-${number}`)?.toString().trim()),
    });
    if (!draft.success || new Set(draft.data.criteria.map(({ text }) => text)).size !== criterionNumbers.length) {
      setError(copy.invalid);
      return;
    }

    const body = JSON.stringify(draft.data);
    if (attempt.current?.body !== body) attempt.current = { body, id: crypto.randomUUID() };
    inFlight.current = true;
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch("/api/researcher/studies", {
        method: "POST", body,
        headers: { "content-type": "application/json", "idempotency-key": attempt.current.id },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 403) {
        setError(copy.signInAgain);
        return;
      }
      const result = response.status === 201 ? StudyMutationResponseSchema.safeParse(await response.json()) : null;
      if (!result?.success) {
        setError(copy.saveFailed);
        return;
      }
      setSaved({ title: draft.data.title, study: result.data });
      attempt.current = null;
    } catch {
      setError(copy.saveFailed);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function launch() {
    if (!launchEnabled || !saved || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch("/api/researcher/studies/launch", {
        method: "POST",
        body: JSON.stringify({ studyId: saved.study.studyId, skip_payment: true }),
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 403) {
        setError(copy.signInAgain);
        return;
      }
      if (response.status === 409) {
        setError(copy.launchConflict);
        return;
      }
      const outcome = response.ok ? StudyMutationResponseSchema.safeParse(await response.json()) : null;
      if (!outcome?.success || outcome.data.studyId !== saved.study.studyId || outcome.data.state !== "fielding") {
        setError(copy.launchFailed);
        return;
      }
      setSaved({ ...saved, study: outcome.data });
    } catch {
      setError(copy.launchFailed);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  if (saved !== undefined) {
    const fielding = saved.study.state === "fielding";
    return (
      <section className={styles.saved} aria-labelledby="draft-created">
        <h2 key={saved.study.state} id="draft-created" tabIndex={-1} ref={(heading) => { heading?.focus(); }}>
          {fielding ? copy.launched : copy.saved}
        </h2>
        <p>{saved.title}</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.savedActions}>
          {launchEnabled && saved.study.state === "draft" &&
            <Button onClick={launch} disabled={saving}>{saving ? copy.launching : copy.launch}</Button>}
          {fielding && (
            <Link href={`/app/studies/${saved.study.studyId}`} className={`ev-button ${styles.trackingLink}`}>
              {copy.viewTracking}
            </Link>
          )}
          <Button variant="secondary" disabled={saving} onClick={() => { setError(undefined); setSaved(undefined); }}>
            {copy.another}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <fieldset className={styles.draftFields} disabled={saving}>
        <div className={styles.details}>
          <Field id="title" name="title" label={copy.studyTitle} required />
          <Field id="target" name="target" type="number" min={1} max={2147483647} required
            label={copy.target} hint={copy.targetHint} />
        </div>
        <fieldset className={styles.group} aria-describedby="criteria-hint">
          <legend>{copy.criteria}</legend>
          <p id="criteria-hint">{copy.criteriaHint}</p>
          {criterionNumbers.map((number) => (
            <div key={number} className={styles.criterion}>
              <div>
                <label htmlFor={`criterion-${number}`}>{copy.criterion} {number}</label>
                <select id={`criterion-${number}`} name={`criterion-${number}`} defaultValue="" required>
                  <option value="" disabled>{copy.chooseCriterion}</option>
                  {gate1CriterionChoices.map(({ text }) => <option key={text}>{text}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`kind-${number}`}>{copy.criterionKind} {number}</label>
                <select id={`kind-${number}`} name={`kind-${number}`} defaultValue={number === 1 ? "must" : "nice"}>
                  {Object.entries(copy.criterionKinds).map(([kind, label]) => (
                    <option key={kind} value={kind}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </fieldset>
        <fieldset className={styles.group} aria-describedby="guide-hint">
          <legend>{copy.guide}</legend>
          <p id="guide-hint">{copy.guideHint}</p>
          {questionNumbers.map((number) => (
            <Field key={number} id={`question-${number}`} name={`question-${number}`}
              label={`${copy.question} ${number}`} required />
          ))}
        </fieldset>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div><Button type="submit">{saving ? copy.saving : copy.save}</Button></div>
      </fieldset>
    </form>
  );
}
