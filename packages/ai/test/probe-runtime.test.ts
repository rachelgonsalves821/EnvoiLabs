import { describe, expect, it, vi } from "vitest";
import type { LLMProvider, LLMResponse } from "../src/index.js";
import { decideProbe, presentProbeIfCurrent, recordProbeAfterPaint, recordProbeRender,
  type ProbeAttempt } from "../src/probe-runtime.js";
import { summarizeProbeOutcomes } from "../src/probe-metrics.js";

const response = (output: unknown): LLMResponse => ({ output, model: "fictional-fixture",
  inputTokens: 0, outputTokens: 0, latencyMs: 0, costMicros: 0 });
const provider = (generate: LLMProvider["generate"]): LLMProvider => ({ generate });
const attempt: ProbeAttempt = { turnId: "answer-1", uploadConfirmedAtMs: 100,
  request: { purpose: "ai_followup", promptVersion: "v1", system: "neutral probe",
    messages: [{ role: "user", content: "Fictional answer" }] } };
const authorize = async () => true;

describe("probe runtime", () => {
  it("does not dispatch with a wrong purpose or denied current grant", async () => {
    const generate = vi.fn(async () => response({ action: "probe", text: "What happened?" }));
    const runtime = { provider: provider(generate), currentTurnId: () => "answer-1",
      authorize: vi.fn(async () => true), timeoutMs: 50 };
    expect(await decideProbe({ ...attempt, request: { ...attempt.request,
      purpose: "probe" } }, runtime)).toMatchObject({ action: "next", outcome: "error" });
    expect(runtime.authorize).not.toHaveBeenCalled();
    expect(await decideProbe(attempt, { ...runtime, authorize: async () => false }))
      .toMatchObject({ action: "next", outcome: "error" });
    expect(await decideProbe(attempt, { ...runtime, authorize: async () => {
      throw new Error("consent read failed");
    } })).toMatchObject({ action: "next", outcome: "error" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("renders a valid probe and measures confirmation through browser paint", async () => {
    const decision = await decideProbe(attempt, { provider: provider(async () => response({ action: "probe",
      text: "What happened next?" })), currentTurnId: () => "answer-1", authorize, timeoutMs: 50 });
    expect(decision).toMatchObject({ action: "probe", text: "What happened next?" });
    let frames = 0;
    const outcome = await recordProbeAfterPaint(decision, () => "answer-1", (callback) => {
      frames++; callback();
    }, () => 650);
    expect(frames).toBe(2);
    expect(outcome).toEqual({ outcome: "rendered", uploadConfirmedAtMs: 100, renderedAtMs: 650 });
  });

  it("advances without a probe on intentional next, provider error, timeout or invalid output", async () => {
    const currentTurnId = () => "answer-1";
    const next = await decideProbe(attempt, { provider: provider(async () => response({ action: "next" })),
      currentTurnId, authorize, timeoutMs: 50 });
    const error = await decideProbe(attempt, { provider: provider(async () => { throw Error("offline"); }),
      currentTurnId, authorize, timeoutMs: 50 });
    const timeout = await decideProbe(attempt, { provider: provider(() => new Promise(() => undefined)),
      currentTurnId, authorize, timeoutMs: 1 });
    const invalid = await decideProbe(attempt, { provider: provider(async () => response({ action: "probe",
      text: "Tell me more" })), currentTurnId, authorize, timeoutMs: 50 });
    const leading = await decideProbe(attempt, { provider: provider(async () => response({ action: "probe",
      text: "Don't you think checkout was bad?" })), currentTurnId, authorize, timeoutMs: 50 });
    expect([next, error, timeout, invalid, leading]).toEqual([
      { action: "next", turnId: "answer-1", outcome: "no_probe" },
      { action: "next", turnId: "answer-1", outcome: "error" },
      { action: "next", turnId: "answer-1", outcome: "timeout" },
      { action: "next", turnId: "answer-1", outcome: "error" },
      { action: "next", turnId: "answer-1", outcome: "error" },
    ]);
    expect(summarizeProbeOutcomes([next, error, timeout, invalid, leading].map((item) =>
      recordProbeRender(item, currentTurnId(), 0)))).toMatchObject({
      total: 5, rendered: 0, noProbe: 1, errors: 3, timeouts: 1, renderedP95Ms: null,
    });
  });

  it("discards a provider result that arrives after the next question", async () => {
    let active = "answer-1";
    let resolve: (value: LLMResponse) => void = () => undefined;
    const pending = decideProbe(attempt, { provider: provider(() => new Promise((done) => { resolve = done; })),
      currentTurnId: () => active, authorize, timeoutMs: 100 });
    active = "answer-2";
    resolve(response({ action: "probe", text: "What happened?" }));
    expect(await pending).toEqual({ action: "next", turnId: "answer-1", outcome: "superseded" });
  });

  it("discards a valid decision if the question changes before browser paint", async () => {
    let active = "answer-1";
    const decision = await decideProbe(attempt, { provider: provider(async () => response({ action: "probe",
      text: "How did that feel?" })), currentTurnId: () => active, authorize, timeoutMs: 50 });
    active = "answer-2";
    expect(recordProbeRender(decision, active, 400)).toEqual({ outcome: "superseded" });
    expect(await recordProbeAfterPaint(decision, () => active, (callback) => callback(), () => 400))
      .toEqual({ outcome: "superseded" });
    let mounts = 0;
    expect(await presentProbeIfCurrent(decision, () => active, () => { mounts++; },
      (callback) => callback(), () => 400)).toEqual({ outcome: "superseded" });
    expect(mounts).toBe(0);
  });

  it("mounts only for the current turn and records a failed mount as an error", async () => {
    const decision = await decideProbe(attempt, { provider: provider(async () => response({ action: "probe",
      text: "What happened next?" })), currentTurnId: () => "answer-1", authorize, timeoutMs: 50 });
    const mounted: string[] = [];
    expect(await presentProbeIfCurrent(decision, () => "answer-1", (text) => { mounted.push(text); },
      (callback) => callback(), () => 350)).toMatchObject({ outcome: "rendered", renderedAtMs: 350 });
    expect(mounted).toEqual(["What happened next?"]);
    expect(await presentProbeIfCurrent(decision, () => "answer-1", () => { throw Error("DOM failed"); },
      (callback) => callback(), () => 350)).toEqual({ outcome: "error" });
  });
});
