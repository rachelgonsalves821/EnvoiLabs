import type { LLMProvider, LLMRequest } from "./index.js";
import type { ProbeOutcome } from "./probe-metrics.js";

const obviousLeading = /^(?:don't you|wouldn't you|didn't you|isn't it|wasn't it|would you agree)\b/i;

export interface ProbeAttempt {
  /** Unique answer/guide-turn ID; never reuse for another core question. */
  readonly turnId: string;
  /** Monotonic browser timestamp captured when upload confirmation is shown. */
  readonly uploadConfirmedAtMs: number;
  readonly request: LLMRequest;
}

export type ProbeDecision =
  | { readonly action: "probe"; readonly turnId: string; readonly text: string; readonly uploadConfirmedAtMs: number }
  | { readonly action: "next"; readonly turnId: string; readonly outcome: "no_probe" | "error" | "timeout" | "superseded" };

export interface ProbeRuntime {
  readonly provider: LLMProvider;
  readonly currentTurnId: () => string;
  /** Recheck the current purpose grant and source receipt before model dispatch. */
  readonly authorize: (attempt: ProbeAttempt) => Promise<boolean>;
  readonly timeoutMs: number;
  readonly schedule?: typeof setTimeout;
  readonly cancel?: typeof clearTimeout;
}

function parseDecision(output: unknown): { action: "probe"; text: string } | { action: "next" } | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const data = output as Record<string, unknown>;
  if (data.action === "next" && Object.keys(data).length === 1) return { action: "next" };
  if (data.action === "probe" && Object.keys(data).sort().join(",") === "action,text"
    && typeof data.text === "string" && data.text.trim() === data.text
    && data.text.length > 0 && data.text.length <= 240 && data.text.endsWith("?")
    && !obviousLeading.test(data.text)) {
    return { action: "probe", text: data.text };
  }
  return null;
}

/** Provider failures and timeouts deterministically advance with no generated probe. */
export async function decideProbe(attempt: ProbeAttempt, runtime: ProbeRuntime): Promise<ProbeDecision> {
  const next = (outcome: Extract<ProbeDecision, { action: "next" }>["outcome"]): ProbeDecision =>
    ({ action: "next", turnId: attempt.turnId, outcome });
  if (!attempt.turnId || !Number.isFinite(attempt.uploadConfirmedAtMs)
    || !Number.isSafeInteger(runtime.timeoutMs) || runtime.timeoutMs <= 0) return next("error");
  if (runtime.currentTurnId() !== attempt.turnId) return next("superseded");
  if (attempt.request.purpose !== "ai_followup") return next("error");
  const schedule = runtime.schedule ?? setTimeout;
  const cancel = runtime.cancel ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!await runtime.authorize(attempt)) return next("error");
    if (runtime.currentTurnId() !== attempt.turnId) return next("superseded");
    const result = await Promise.race([
      runtime.provider.generate(attempt.request).then(({ output }) => ({ kind: "output" as const, output }),
        () => ({ kind: "error" as const })),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = schedule(() => resolve({ kind: "timeout" }), runtime.timeoutMs);
      }),
    ]);
    if (runtime.currentTurnId() !== attempt.turnId) return next("superseded");
    if (result.kind === "timeout") return next("timeout");
    if (result.kind === "error") return next("error");
    const parsed = parseDecision(result.output);
    if (!parsed) return next("error");
    if (parsed.action === "next") return next("no_probe");
    return { action: "probe", turnId: attempt.turnId, text: parsed.text,
      uploadConfirmedAtMs: attempt.uploadConfirmedAtMs };
  } catch {
    return runtime.currentTurnId() === attempt.turnId ? next("error") : next("superseded");
  } finally {
    if (timer !== undefined) cancel(timer);
  }
}

/** Call after the probe is mounted and painted; a later question invalidates the result. */
export function recordProbeRender(decision: ProbeDecision, currentTurnId: string,
  renderedAtMs: number): ProbeOutcome {
  if (decision.action === "next") return { outcome: decision.outcome };
  if (decision.turnId !== currentTurnId) return { outcome: "superseded" };
  if (!Number.isFinite(renderedAtMs) || renderedAtMs < decision.uploadConfirmedAtMs)
    return { outcome: "error" };
  return { outcome: "rendered", uploadConfirmedAtMs: decision.uploadConfirmedAtMs, renderedAtMs };
}

/** Browser hook: invoke after mounting the probe; the second frame observes its paint. */
export async function recordProbeAfterPaint(decision: ProbeDecision, currentTurnId: () => string,
  frame: (callback: () => void) => void, now: () => number): Promise<ProbeOutcome> {
  if (decision.action === "next") return { outcome: decision.outcome };
  await new Promise<void>((resolve) => frame(() => frame(resolve)));
  return recordProbeRender(decision, currentTurnId(), now());
}

/** Only the active answer may mount a probe; then measure its browser paint. */
export async function presentProbeIfCurrent(decision: ProbeDecision, currentTurnId: () => string,
  mount: (text: string) => void, frame: (callback: () => void) => void,
  now: () => number): Promise<ProbeOutcome> {
  if (decision.action === "next") return { outcome: decision.outcome };
  if (currentTurnId() !== decision.turnId) return { outcome: "superseded" };
  try {
    mount(decision.text);
  } catch {
    return { outcome: "error" };
  }
  return recordProbeAfterPaint(decision, currentTurnId, frame, now);
}
