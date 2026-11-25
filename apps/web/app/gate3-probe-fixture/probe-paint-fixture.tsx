"use client";

import { presentCommittedProbe, type CommittedProbe, type ProbeDecisionPort,
  type ProbeOutcome } from "@envoi-labs/ai";
import { useRef, useState } from "react";

const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function ProbePaintFixture() {
  const activeTurn = useRef(id(4));
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<ProbeOutcome["outcome"] | "idle">("idle");
  const [shownCalls, setShownCalls] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);

  async function run(mode: "paint" | "suspended" | "superseded") {
    activeTurn.current = id(4);
    setText(""); setOutcome("idle"); setShownCalls(0); setLatency(null);
    const uploadConfirmedAtMs = performance.now() - 100;
    const committed: CommittedProbe = { sessionId: id(1), questionId: id(2),
      answerId: id(3), turnId: id(4), transcriptRevision: "fictional-revision",
      sourceVersion: id(5), probeId: id(6),
      decision: { action: "probe", turnId: id(4), text: "What shaped your choice?",
        uploadConfirmedAtMs } };
    const port: ProbeDecisionPort = {
      async readCommitted() { return null; }, async readReadyTurn() { return null; },
      async commitDecision() { return { status: "unavailable" }; },
      async markShown() { setShownCalls((n) => n + 1); return "recorded"; },
    };
    const result = await presentCommittedProbe(port, committed,
      () => activeTurn.current,
      (value) => { setText(value); if (mode === "superseded") activeTurn.current = id(7); },
      mode === "suspended" ? () => undefined : requestAnimationFrame,
      () => performance.now(), () => setText(""),
      { timeoutMs: mode === "suspended" ? 80 : 1000 });
    setOutcome(result.outcome);
    if (result.outcome === "rendered")
      setLatency(result.renderedAtMs - result.uploadConfirmedAtMs);
  }

  return <main style={{ maxWidth: 560, marginInline: "auto", padding: 16 }}>
    <h1>Fictional probe paint fixture</h1>
    <button type="button" onClick={() => void run("paint")}>Paint probe</button>
    <button type="button" onClick={() => void run("suspended")}>Suspend frames</button>
    <button type="button" onClick={() => void run("superseded")}>Change turn</button>
    <p role="status" data-outcome={outcome}>Outcome: {outcome}</p>
    <p data-shown-calls={shownCalls}>Shown receipts: {shownCalls}</p>
    <p data-latency={latency ?? ""}>Paint latency: {latency === null ? "none" : latency.toFixed(1)}</p>
    {text && <p data-probe-text>{text}</p>}
  </main>;
}
