"use client";

import { readMarketplaceFeasibilityView, type FeasibilityView } from "@envoi-labs/ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { StudyFeasibilityPanel } from "./study-feasibility-panel";

type State = { readonly scope: string; readonly kind: "loading" | "unavailable" } |
  { readonly scope: string; readonly kind: "ready"; readonly view: FeasibilityView };

/** Mount only after the study ID and target are authorized together. */
export function StudyFeasibilityLivePanel({ studyId, targetRespondents }: {
  studyId: string; targetRespondents: number;
}) {
  const scope = `${studyId}:${targetRespondents}`;
  const [state, setState] = useState<State>({ scope, kind: "loading" });
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState({ scope, kind: "loading" });
    const view = await readMarketplaceFeasibilityView(studyId, targetRespondents);
    if (request !== generation.current) return;
    setState(view ? { scope, kind: "ready", view } : { scope, kind: "unavailable" });
  }, [scope, studyId, targetRespondents]);

  useEffect(() => {
    void load();
    return () => { generation.current++; };
  }, [load]);

  const current = state.scope === scope ? state : { scope, kind: "loading" as const };
  return <div aria-live="polite">
    {current.kind === "ready" &&
      <StudyFeasibilityPanel view={current.view} targetRespondents={targetRespondents} />}
    {current.kind === "loading" && <p role="status">Checking the current matching outlook…</p>}
    {current.kind === "unavailable" && <p role="status">Matching outlook is currently unavailable.</p>}
    <button type="button" disabled={current.kind === "loading"} onClick={() => { void load(); }}>
      {current.kind === "loading" ? "Checking matching outlook…" : "Check matching outlook again"}
    </button>
  </div>;
}
