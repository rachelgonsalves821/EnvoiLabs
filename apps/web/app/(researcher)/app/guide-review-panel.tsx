"use client";

import { Button } from "@envoi-labs/ui";
import { useEffect, useRef, useState } from "react";
import styles from "./guide-review.module.css";

export interface GuideReviewSnapshot {
  readonly revision: string;
  readonly questions: readonly string[];
  readonly approved: boolean;
}
export interface GuideReviewPort {
  /** Platform must enforce current researcher/org access and private no-store reads. */
  readCurrent(): Promise<unknown | null>;
  /** Compare-and-set the revision and persist a new version plus edit/approval audit. */
  save(input: { readonly revision: string; readonly questions: readonly string[];
    readonly approved: boolean }): Promise<unknown | null>;
  /** Model rewrite requires its own approved provider policy and a fresh version check. */
  rewrite(input: { readonly revision: string; readonly index: number }): Promise<unknown | null>;
}

function parseSnapshot(value: unknown): GuideReviewSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "approved,questions,revision"
    || typeof record.revision !== "string" || !record.revision.trim()
    || typeof record.approved !== "boolean" || !Array.isArray(record.questions)
    || record.questions.length < 4 || record.questions.length > 10
    || !record.questions.every((question) => typeof question === "string" && !!question.trim()))
    return null;
  return { revision: record.revision, approved: record.approved,
    questions: [...record.questions] as string[] };
}

function possiblyLeading(question: string): boolean {
  return /\b(?:don't you agree|wouldn't you|how much do you love|would you pay)\b/i.test(question);
}

/** Review a versioned guide before study quote/launch; no live port is supplied here. */
export function GuideReviewPanel({ port }: { port: GuideReviewPort }) {
  const [snapshot, setSnapshot] = useState<GuideReviewSnapshot | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const inFlight = useRef(false);
  const moveButtons = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const request = ++generation.current;
      inFlight.current = false;
      setBusy(true);
      setSnapshot(null);
      setQuestions([]);
      try {
        const current = parseSnapshot(await port.readCurrent());
        if (active && request === generation.current) {
          setSnapshot(current);
          setQuestions(current ? [...current.questions] : []);
        }
      } catch { if (active && request === generation.current) setSnapshot(null); }
      finally { if (active && request === generation.current) setBusy(false); }
    };
    void refresh();
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { active = false; generation.current++; document.removeEventListener("visibilitychange", onVisibility); };
  }, [port]);

  async function mutate(action: () => Promise<unknown | null>): Promise<boolean> {
    if (!snapshot || inFlight.current) return false;
    inFlight.current = true;
    const request = ++generation.current;
    const previousRevision = snapshot.revision;
    setBusy(true);
    setSnapshot(null);
    setQuestions([]);
    setNotice("");
    try {
      const next = parseSnapshot(await action());
      if (request !== generation.current) return false;
      if (!next || next.revision === previousRevision) return false;
      setSnapshot(next);
      setQuestions([...next.questions]);
      setNotice(next.approved ? "Guide approved." : "Guide updated.");
      return true;
    } catch { return false; }
    finally { if (request === generation.current) { setBusy(false); inFlight.current = false; } }
  }

  const dirty = !!snapshot && JSON.stringify(questions) !== JSON.stringify(snapshot.questions);
  const valid = questions.length >= 4 && questions.length <= 10
    && questions.every((question) => question.trim().length > 0 && question.includes("?"));
  const flagged = questions.some(possiblyLeading);

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setQuestions(next);
    requestAnimationFrame(() => moveButtons.current[target]?.focus());
  }

  return <section className={styles.panel} aria-label="Review interview guide" aria-busy={busy}>
    <h2>Review interview guide</h2>
    {busy && <p role="status">Checking the current guide…</p>}
    {!busy && !snapshot && <p role="status">The guide is currently unavailable.</p>}
    {snapshot && <>
      <p>Keep four to ten open questions about people’s past behavior. The draft starts with six to eight.</p>
      {snapshot.approved && <p role="status">This guide is approved. Saving an edit will reopen review.</p>}
      <ol className={styles.questions}>{questions.map((question, index) =>
        <li key={index}>
          <label htmlFor={`guide-question-${index}`}>Question {index + 1}</label>
          <textarea id={`guide-question-${index}`} value={question} rows={2}
            onChange={(event) => setQuestions((prior) => prior.map((item, position) =>
              position === index ? event.target.value : item))} />
          {possiblyLeading(question) && <p role="status" className={styles.warning}>
            This may be leading. Ask about a past action instead.</p>}
          <div className={styles.actions}>
            <Button type="button" variant="secondary" disabled={index === 0} onClick={() => move(index, -1)}
              ref={(element) => { moveButtons.current[index] = element; }}>Move up</Button>
            <Button type="button" variant="secondary" disabled={index === questions.length - 1}
              onClick={() => move(index, 1)}>Move down</Button>
            <Button type="button" variant="secondary" disabled={dirty}
              onClick={() => { void mutate(() => port.rewrite({ revision: snapshot.revision, index })); }}>
              Suggest rewrite
            </Button>
          </div>
        </li>)}</ol>
      {!valid && <p role="alert" className={styles.warning}>Use four to ten nonempty questions ending in a question mark.</p>}
      <div className={styles.actions}>
        <Button type="button" disabled={!dirty || !valid} onClick={() => {
          void mutate(() => port.save({ revision: snapshot.revision, questions, approved: false }));
        }}>Save guide changes</Button>
        <Button type="button" variant="secondary" disabled={dirty || !valid || flagged || snapshot.approved}
          onClick={() => { void mutate(() => port.save({ revision: snapshot.revision,
            questions: snapshot.questions, approved: true })); }}>Approve guide</Button>
      </div>
    </>}
    <p role="status" className={styles.notice}>{notice}</p>
  </section>;
}
