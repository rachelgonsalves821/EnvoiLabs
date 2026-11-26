import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGate2ScreeningWorkerPorts, runGate2ScreeningAudioJob } from "./gate2-screening-worker.mjs";

const audioObjectId = "11111111-1111-4111-8111-111111111111";
const inviteId = "22222222-2222-4222-8222-222222222222";
const leaseId = "33333333-3333-4333-8333-333333333333";
const bytes = Buffer.from("1a45dfa3", "hex");
const claim = { audioObjectId, leaseId, storagePath: `screening/${inviteId}/${audioObjectId}`,
  bytes: bytes.length, mime: "audio/webm", sha256: createHash("sha256").update(bytes).digest("hex"),
  durationMs: 5000 };
function setup({ current = true, recorded = bytes, transcriber = null } = {}) {
  const rpc = vi.fn(async (name) => ({ data: name === "claim_gate2_screening_audio" ? claim :
    name === "validate_gate2_screening_audio" ? current :
      name === "complete_gate2_screening_audio" ? { status: "completed" } : true, error: null }));
  const download = vi.fn(async () => ({ data: new Blob([recorded],
    { type: "audio/webm" }), error: null }));
  const actualTranscriber = transcriber ?? { transcribe: vi.fn(async () => ({
    text: "I worked as a nurse.", provider: "fixture", model: "synthetic", latencyMs: 1, costMicros: 0,
  })) };
  const client = { rpc, storage: { from: (bucket) => {
    expect(bucket).toBe("gate2-screening-audio");
    return { download };
  } } };
  return { rpc, download, transcriber: actualTranscriber,
    ports: createGate2ScreeningWorkerPorts(client, { audioObjectId, transcriber: actualTranscriber }) };
}

describe("leased private screening transcription", () => {
  it("hashes the exact private recording and rechecks consent before completion", async () => {
    const { ports, rpc, transcriber } = setup();
    expect(await runGate2ScreeningAudioJob(ports)).toBe("completed");
    expect(transcriber.transcribe).toHaveBeenCalledWith({ audio: Uint8Array.from(bytes),
      mediaType: "audio/webm" });
    expect(rpc).toHaveBeenCalledWith("complete_gate2_screening_audio", {
      supplied_audio_id: audioObjectId, supplied_lease_id: leaseId,
      supplied_text: "I worked as a nurse.", supplied_provider: "fixture",
      supplied_model: "synthetic",
    });
    expect(rpc.mock.calls.filter(([name]) => name === "validate_gate2_screening_audio")).toHaveLength(3);
  });
  it("never transcribes a revoked lease or mismatched object", async () => {
    const revoked = setup({ current: false });
    expect(await runGate2ScreeningAudioJob(revoked.ports)).toBe("stale");
    expect(revoked.download).not.toHaveBeenCalled();
    const tampered = setup({ recorded: Buffer.from("tampered") });
    expect(await runGate2ScreeningAudioJob(tampered.ports)).toBe("retry");
    expect(tampered.transcriber.transcribe).not.toHaveBeenCalled();
    expect(tampered.rpc).toHaveBeenCalledWith("retry_gate2_screening_audio", {
      supplied_audio_id: audioObjectId, supplied_lease_id: leaseId,
    });
  });
  it("retries provider failures without creating a receipt", async () => {
    const transcriber = { transcribe: vi.fn(async () => { throw new Error("provider outage"); }) };
    const { ports, rpc } = setup({ transcriber });
    expect(await runGate2ScreeningAudioJob(ports)).toBe("retry");
    expect(rpc.mock.calls.some(([name]) => name === "complete_gate2_screening_audio")).toBe(false);
  });
  it("rejects an unscoped claim before reading storage", async () => {
    const { ports, rpc, download } = setup();
    rpc.mockResolvedValueOnce({ data: { ...claim, storagePath: `other/${audioObjectId}` }, error: null });
    await expect(runGate2ScreeningAudioJob(ports)).rejects.toThrow("Invalid screening audio claim");
    expect(download).not.toHaveBeenCalled();
  });
});
