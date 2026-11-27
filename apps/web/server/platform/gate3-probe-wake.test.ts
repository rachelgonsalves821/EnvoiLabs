import { Inngest } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { gate3ProbeWakeFunction } from "../../inngest/platform/gate3-probe-wake";
import { dispatchGate3ProbeWake, qualifiedAnswerEvent,
  scheduleUploadReceiptWake, uploadReceiptEvent, uploadReceiptWakeEvent } from "./gate3-probe-wake";

const answerId = "a9720000-0000-4000-8000-000000000005";
const candidate = { answerId,
  sessionId: "a9720000-0000-4000-8000-000000000004",
  authUserId: "90300000-0000-4000-8000-000000000001" };
const request = { purpose: "ai_followup", promptVersion: "fixture-1",
  system: "Synthetic only", messages: [{ role: "user" as const, content: "Fixture" }] };

describe("default-off targeted probe wake", () => {
  it("registers distinct event names without a live model caller", async () => {
    const worker = gate3ProbeWakeFunction(new Inngest({ id: "fixture" }),
      async () => "stale");
    expect(worker.opts.triggers).toEqual([
      { event: qualifiedAnswerEvent }, { event: uploadReceiptEvent }]);
    expect(worker.opts.concurrency).toEqual({ limit: 8 });
    expect(worker.opts.retries).toBe(1);
    expect(uploadReceiptWakeEvent(answerId)).toEqual({
      id: `gate3-probe-upload-receipted:${answerId}`,
      name: uploadReceiptEvent, data: { answerId } });
    expect(uploadReceiptWakeEvent("bad")).toBeNull();
    expect(`gate1-answer-qualified:${answerId}`)
      .not.toBe(uploadReceiptWakeEvent(answerId)?.id);
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await scheduleUploadReceiptWake(answerId, send)).toBe("sent");
    expect(send).toHaveBeenCalledWith(uploadReceiptWakeEvent(answerId));
    expect(await scheduleUploadReceiptWake("bad", send)).toBe("ineligible");
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRejectedValue(new Error("synthetic transport failure"));
    expect(await scheduleUploadReceiptWake(answerId, send)).toBe("unavailable");
  });

  it("rejects disabled, unknown or source-bearing events before any database or runner call", async () => {
    const call = vi.fn();
    const buildRequest = vi.fn(() => request);
    const runSaved = vi.fn();
    const options = { enabled: false, call, buildRequest, runSaved };
    expect(await dispatchGate3ProbeWake({ name: qualifiedAnswerEvent,
      data: { answerId } }, options)).toBe("disabled");
    for (const event of [
      { name: "other", data: { answerId } },
      { name: qualifiedAnswerEvent, data: { answerId, sourceText: "private" } },
      { name: uploadReceiptEvent, data: { answerId: "bad" } },
    ]) expect(await dispatchGate3ProbeWake(event, { ...options, enabled: true }))
      .toBe("ineligible");
    expect(call).not.toHaveBeenCalled();
    expect(buildRequest).not.toHaveBeenCalled();
    expect(runSaved).not.toHaveBeenCalled();
  });

  it("lets either event target the same authorized answer after receipt and qualification", async () => {
    const call = vi.fn().mockImplementation(async (name: string) => ({ error: null,
      data: name === "read_gate3_probe_ready_answer" ? candidate
        : "a9720000-0000-4000-8000-000000000006" }));
    const buildRequest = vi.fn(() => request);
    const runSaved = vi.fn(async (selected: typeof candidate,
      port: { beginCurrentTurn: (id: string) => Promise<string | null> }) => {
      expect(selected).toEqual(candidate);
      expect(await port.beginCurrentTurn(answerId))
        .toBe("a9720000-0000-4000-8000-000000000006");
      return { status: "committed" as const };
    });
    const options = { enabled: true, call, buildRequest, runSaved };
    for (const name of [qualifiedAnswerEvent, uploadReceiptEvent])
      expect(await dispatchGate3ProbeWake({ name, data: { answerId } }, options))
        .toBe("committed");
    expect(runSaved).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith("begin_gate3_probe_turn_with_clock", {
      supplied_answer_id: answerId, supplied_auth_user_id: candidate.authUserId });
    expect(buildRequest).not.toHaveBeenCalled();
    call.mockResolvedValue({ data: null, error: null });
    expect(await dispatchGate3ProbeWake({ name: uploadReceiptEvent,
      data: { answerId } }, options)).toBe("stale");
    expect(runSaved).toHaveBeenCalledTimes(2);
  });
});
