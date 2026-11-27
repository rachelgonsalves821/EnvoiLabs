import type { SessionResponse } from "@envoi-labs/contracts";

export function currentPrompt(session: SessionResponse) {
  if (session.currentProbe) return { kind: "probe" as const,
    text: session.currentProbe.text, id: session.currentProbe.probeId };
  if (session.probePending) return { kind: "pending" as const };
  if (session.nextQuestion) return { kind: "core" as const,
    text: session.nextQuestion.text, id: session.nextQuestion.id };
  return { kind: "complete" as const };
}
