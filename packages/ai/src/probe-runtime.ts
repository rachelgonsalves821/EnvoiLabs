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

export interface ProbePaintWait {
  /** Maximum additional wait; the six-second upload-to-paint deadline is still enforced. */
  readonly timeoutMs?: number;
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
    const deadline = new Promise<{ kind: "timeout" }>((resolve) => {
      timer = schedule(() => resolve({ kind: "timeout" }), runtime.timeoutMs);
    });
    const authorized = await Promise.race([
      runtime.authorize(attempt).then((value) => ({ kind: "authorized" as const, value }),
        () => ({ kind: "error" as const })),
      deadline,
    ]);
    if (authorized.kind === "timeout") return runtime.currentTurnId() === attempt.turnId
      ? next("timeout") : next("superseded");
    if (runtime.currentTurnId() !== attempt.turnId) return next("superseded");
    if (authorized.kind === "error" || !authorized.value) return next("error");
    const result = await Promise.race([
      runtime.provider.generate(attempt.request).then(({ output }) => ({ kind: "output" as const, output }),
        () => ({ kind: "error" as const })),
      deadline,
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
  frame: (callback: () => void) => void, now: () => number,
  wait: ProbePaintWait = {}): Promise<ProbeOutcome> {
  if (decision.action === "next") return { outcome: decision.outcome };
  const remaining = Math.min(wait.timeoutMs ?? 6000,
    decision.uploadConfirmedAtMs + 6000 - now());
  if (!Number.isFinite(remaining) || remaining <= 0) return { outcome: "timeout" };
  const schedule = wait.schedule ?? setTimeout;
  const cancel = wait.cancel ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const painted = new Promise<"painted">((resolve, reject) => {
      try {
        frame(() => {
          try { frame(() => resolve("painted")); }
          catch (error) { reject(error); }
        });
      } catch (error) { reject(error); }
    });
    const limit = new Promise<"timeout">((resolve) => {
      timer = schedule(() => resolve("timeout"), remaining);
    });
    if (await Promise.race([painted, limit]) === "timeout")
      return { outcome: currentTurnId() === decision.turnId ? "timeout" : "superseded" };
  } finally {
    if (timer !== undefined) cancel(timer);
  }
  const current = currentTurnId();
  if (current !== decision.turnId) return { outcome: "superseded" };
  const renderedAt = now();
  if (renderedAt > decision.uploadConfirmedAtMs + 6000) return { outcome: "timeout" };
  return recordProbeRender(decision, current, renderedAt);
}

/** Only the active answer may mount a probe; then measure its browser paint. */
export async function presentProbeIfCurrent(decision: ProbeDecision, currentTurnId: () => string,
  mount: (text: string) => void, frame: (callback: () => void) => void,
  now: () => number, wait: ProbePaintWait = {}): Promise<ProbeOutcome> {
  if (decision.action === "next") return { outcome: decision.outcome };
  if (currentTurnId() !== decision.turnId) return { outcome: "superseded" };
  try {
    mount(decision.text);
  } catch {
    return { outcome: "error" };
  }
  return recordProbeAfterPaint(decision, currentTurnId, frame, now, wait);
}
