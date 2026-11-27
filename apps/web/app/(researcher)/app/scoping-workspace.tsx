"use client";

import { BriefPatchSchema, type BriefPatch } from "@envoi-labs/contracts";
import { Button } from "@envoi-labs/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./scoping.module.css";

type Stage = "decision" | "hypotheses" | "eligibility" | "exclusions"
  | "targetCompletes" | "stimulus" | "deadlineAt";
type Message = { readonly role: "researcher" | "agent"; readonly text: string;
  readonly quickReplies?: readonly string[] };
export interface ScopingSnapshot {
  readonly revision: string;
  readonly stage: Stage;
  readonly brief: BriefPatch;
  readonly messages: readonly Message[];
}
export interface ScopingWorkspacePort {
  /** Every method must enforce current researcher authorization and return null on revocation. */
  readCurrent(): Promise<unknown | null>;
  /** Platform must compare `revision` and commit the answer, turn and brief patch atomically. */
  send(input: { readonly revision: string; readonly text: string }): Promise<unknown | null>;
  edit(input: { readonly revision: string; readonly patch: BriefPatch }): Promise<unknown | null>;
}

const stages: readonly Stage[] = ["decision", "hypotheses", "eligibility", "exclusions",
  "targetCompletes", "stimulus", "deadlineAt"];
const stageLabels: Record<Stage, string> = { decision: "Decision", hypotheses: "Hypotheses",
  eligibility: "Who to hear from", exclusions: "Exclusions", targetCompletes: "Target completes",
  stimulus: "Concept or material", deadlineAt: "Deadline" };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function parseSnapshot(value: unknown): ScopingSnapshot | null {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "brief,messages,revision,stage"
    || typeof value.revision !== "string" || !value.revision.trim()
    || !stages.includes(value.stage as Stage) || !BriefPatchSchema.safeParse(value.brief).success
    || !Array.isArray(value.messages) || value.messages.length > 100) return null;
  const messages: Message[] = [];
  for (const item of value.messages) {
    if (!isRecord(item) || !["agent", "researcher"].includes(String(item.role))
      || typeof item.text !== "string" || !item.text.trim()
      || Object.keys(item).some((key) => !["role", "text", "quickReplies"].includes(key))) return null;
    if (item.quickReplies !== undefined && (item.role !== "agent"
      || !Array.isArray(item.quickReplies) || item.quickReplies.length < 2
      || item.quickReplies.length > 4 || !item.quickReplies.every((reply) =>
        typeof reply === "string" && !!reply.trim())
      || !item.quickReplies.some((reply) =>
        typeof reply === "string" && reply.trim().toLowerCase() === "something else"))) return null;
    messages.push({ role: item.role as Message["role"], text: item.text,
      ...(item.quickReplies === undefined ? {} : { quickReplies: [...item.quickReplies] as string[] }) });
  }
  return { revision: value.revision, stage: value.stage as Stage,
    brief: structuredClone(value.brief) as BriefPatch, messages };
}

function lines(value: string): string[] { return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean); }
function criteriaText(brief: BriefPatch, kind: "must" | "nice" | "exclude"): string {
  return brief.criteria?.filter((item) => item.kind === kind).map((item) => item.text).join("\n") ?? "";
}

/** Researcher surface awaiting an authenticated, revision-checked Platform port. */
export function ScopingWorkspace({ port }: { port: ScopingWorkspacePort }) {
  const [snapshot, setSnapshot] = useState<ScopingSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [text, setText] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const generation = useRef(0);
  const inFlight = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const request = ++generation.current;
      inFlight.current = false;
      setSnapshot(null);
      setBusy(true);
      try {
        const current = parseSnapshot(await port.readCurrent());
        if (active && request === generation.current) setSnapshot(current);
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
    const previous = snapshot;
    setSnapshot(null);
    setBusy(true);
    setAnnouncement("");
    try {
      const next = parseSnapshot(await action());
      if (request !== generation.current) return false;
      if (!next || next.revision === previous.revision) { setSnapshot(null); return false; }
      setSnapshot(next);
      const changed = Object.keys(next.brief).filter((key) =>
        JSON.stringify(next.brief[key as keyof BriefPatch])
          !== JSON.stringify(previous.brief[key as keyof BriefPatch]));
      setAnnouncement(changed.length ? `Brief updated: ${changed.join(", ")}.` : "Conversation updated.");
      return true;
    } catch { if (request === generation.current) setSnapshot(null); return false; }
    finally { if (request === generation.current) { setBusy(false); inFlight.current = false; } }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const answer = text.trim();
    if (!snapshot || !answer) return;
    const revision = snapshot.revision;
    if (await mutate(() => port.send({ revision, text: answer }))) setText("");
  }

  async function edit(field: Stage | "title", value: string, criterionKind: "must" | "nice" = "must") {
    if (!snapshot) return;
    const revision = snapshot.revision;
    let patch: BriefPatch;
    if (field === "title") patch = { title: value.trim() };
    else if (field === "hypotheses") patch = { hypotheses: lines(value) };
    else if (field === "targetCompletes") {
      if (Number(value) < 10) { setAnnouncement("Choose at least 10 completes."); return; }
      patch = { targetCompletes: Number(value) };
    }
    else if (field === "deadlineAt") patch = { deadlineAt: value };
    else if (field === "stimulus") patch = { stimulus: value.trim() || null };
    else if (field === "decision") patch = { decision: value.trim() };
    else {
      const kind: "must" | "nice" | "exclude" = field === "exclusions" ? "exclude" : criterionKind;
      const prior = snapshot.brief.criteria?.filter((item) => item.kind !== kind) ?? [];
      patch = { criteria: [...prior, ...lines(value).map((item) => ({ kind, text: item }))] };
    }
    if (!BriefPatchSchema.safeParse(patch).success) { setAnnouncement("Check this field and try again."); return; }
    await mutate(() => port.edit({ revision, patch }));
  }

  const brief = snapshot?.brief;
  const latest = snapshot?.messages.at(-1);
  return <section className={styles.workspace} aria-label="Scope a study" aria-busy={busy}>
    <div className={styles.chat}>
      <h2>Study conversation</h2>
      {busy && <p role="status">Checking the current study brief…</p>}
      {!busy && !snapshot && <p role="status">The study conversation is currently unavailable.</p>}
      {snapshot && <>
        <ol className={styles.messages}>{snapshot.messages.map((message, index) =>
          <li key={`${snapshot.revision}-${index}`}>
            <strong>{message.role === "agent" ? "Research assistant" : "You"}</strong>
            <p>{message.text}</p>
          </li>)}</ol>
        {latest?.role === "agent" && latest.quickReplies && <div className={styles.replies}
          aria-label="Suggested replies">{latest.quickReplies.map((reply) =>
            <Button key={reply} type="button" variant="secondary" onClick={() => {
              if (reply.toLowerCase() === "something else") { composer.current?.focus(); return; }
              setText(reply); composer.current?.focus();
            }}>{reply}</Button>)}</div>}
        <form onSubmit={submit} className={styles.composer}>
          <label htmlFor="scoping-answer">Your answer</label>
          <textarea ref={composer} id="scoping-answer" value={text}
            onChange={(event) => setText(event.target.value)} rows={3} required />
          <Button type="submit">Send answer</Button>
        </form>
      </>}
    </div>
    <div className={styles.brief} aria-label="Live study brief">
      <h2>Live brief</h2>
      {snapshot && <p>Next: {stageLabels[snapshot.stage]}</p>}
      {snapshot && <div className={styles.fields}>
        <label>Study title<input key={`${snapshot.revision}-title`} type="text"
          defaultValue={brief?.title ?? ""} onBlur={(event) => {
            if (event.target.value !== (brief?.title ?? "")) void edit("title", event.target.value);
          }} /></label>
        <label>Decision<textarea key={`${snapshot.revision}-decision`} defaultValue={brief?.decision ?? ""}
          onBlur={(event) => { if (event.target.value !== (brief?.decision ?? "")) void edit("decision", event.target.value); }} /></label>
        <label>Hypotheses, one per line<textarea key={`${snapshot.revision}-hypotheses`}
          defaultValue={brief?.hypotheses?.join("\n") ?? ""} onBlur={(event) => {
            if (event.target.value !== (brief?.hypotheses?.join("\n") ?? "")) void edit("hypotheses", event.target.value);
          }} /></label>
        <label>Required behavior, one per line<textarea key={`${snapshot.revision}-must`}
          defaultValue={criteriaText(brief ?? {}, "must")} onBlur={(event) => {
            if (event.target.value !== criteriaText(brief ?? {}, "must")) void edit("eligibility", event.target.value);
          }} /></label>
        <label>Preferred behavior, one per line<textarea key={`${snapshot.revision}-nice`}
          defaultValue={criteriaText(brief ?? {}, "nice")} onBlur={(event) => {
            if (event.target.value !== criteriaText(brief ?? {}, "nice"))
              void edit("eligibility", event.target.value, "nice");
          }} /></label>
        <label>Exclusions, one per line<textarea key={`${snapshot.revision}-exclude`}
          defaultValue={criteriaText(brief ?? {}, "exclude")} onBlur={(event) => {
            if (event.target.value !== criteriaText(brief ?? {}, "exclude")) void edit("exclusions", event.target.value);
          }} /></label>
        <label>Target completes<input key={`${snapshot.revision}-target`} type="number" min={10}
          defaultValue={brief?.targetCompletes ?? ""} onBlur={(event) => {
            if (event.target.value !== String(brief?.targetCompletes ?? "")) void edit("targetCompletes", event.target.value);
          }} /></label>
        <label>Concept or material<textarea key={`${snapshot.revision}-stimulus`}
          defaultValue={brief?.stimulus ?? ""} onBlur={(event) => {
            if (event.target.value !== (brief?.stimulus ?? "")) void edit("stimulus", event.target.value);
          }} /></label>
        <label>Deadline<input key={`${snapshot.revision}-deadline`} type="datetime-local"
          defaultValue={brief?.deadlineAt?.slice(0, 16) ?? ""} onBlur={(event) => {
            if (event.target.value !== (brief?.deadlineAt?.slice(0, 16) ?? "")) {
              const date = new Date(event.target.value);
              if (Number.isNaN(date.getTime())) setAnnouncement("Choose a valid deadline.");
              else void edit("deadlineAt", date.toISOString());
            }
          }} /></label>
      </div>}
    </div>
    <p className={styles.announcement} role="status">{announcement}</p>
  </section>;
}
