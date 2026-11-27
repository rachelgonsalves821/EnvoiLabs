import { createProbeDecisionPort, dispatchReadyProbeAnswer,
  type ProbeReadyCandidate, type ProbeRpc, type ReadyProbeTurn,
} from "@envoi-labs/services/probe-turn";

export const qualifiedAnswerEvent = "envoi/gate1.answer-qualified";
export const uploadReceiptEvent = "envoi/gate3.probe-upload-receipted";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Source = { readonly sourceText: string; readonly questionText: string };
type RunSaved = (candidate: ProbeReadyCandidate,
  port: ReturnType<typeof createProbeDecisionPort>) =>
    Promise<{ readonly status: "committed" | "stale" | "unavailable" }>;

export function uploadReceiptWakeEvent(answerId: string) {
  if (!uuid.test(answerId)) return null;
  return { id: `gate3-probe-upload-receipted:${answerId}`,
    name: uploadReceiptEvent, data: { answerId } } as const;
}

export async function scheduleUploadReceiptWake(answerId: string,
  send: (event: NonNullable<ReturnType<typeof uploadReceiptWakeEvent>>) => Promise<unknown>) {
  const event = uploadReceiptWakeEvent(answerId);
  if (!event) return "ineligible" as const;
  try { await send(event); return "sent" as const; }
  catch { return "unavailable" as const; }
}

// Event payloads carry only the saved answer ID. The targeted selector then
// obtains the current respondent/session from the database, and the runner's
// locked begin/read step obtains current qualified source, consent and deadline.
export async function dispatchGate3ProbeWake(event: { name: string; data: unknown },
  options: { enabled: boolean; call: ProbeRpc;
    buildRequest: (candidate: ProbeReadyCandidate, source: Source) =>
      ReadyProbeTurn["request"]; runSaved: RunSaved }):
  Promise<"disabled" | "ineligible" | "committed" | "stale" | "unavailable"> {
  if (!options.enabled) return "disabled";
  if (event.name !== qualifiedAnswerEvent && event.name !== uploadReceiptEvent)
    return "ineligible";
  const data = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).length !== 1 || !("answerId" in data)
    || typeof data.answerId !== "string" || !uuid.test(data.answerId))
    return "ineligible";
  return dispatchReadyProbeAnswer(options.call, data.answerId,
    options.buildRequest, options.runSaved);
}
