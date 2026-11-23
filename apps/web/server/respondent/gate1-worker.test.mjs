import { describe, expect, it, vi } from "vitest";
import { runGate1AnswerJob } from "@envoi-labs/ai";
import { createGate1DatabasePorts } from "./gate1-worker.mjs";

const answerId = "00000000-0000-4000-8000-000000000001";
const leaseId = "00000000-0000-4000-8000-000000000002";
const objectId = "00000000-0000-4000-8000-000000000003";
const lease = { supplied_answer_id: answerId, supplied_lease_id: leaseId };
const audio = {
  storagePath: `${answerId}/${objectId}`, mime: "audio/webm", bytes: 3, durationMs: 1250,
  sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
};

function database(claim) {
  const rpc = vi.fn(async (name) => ({
    error: null,
    data: name === "claim_gate1_answer_job" ? claim :
      name === "complete_gate1_answer_job" ? { status: "private", transcriptId: objectId } : true,
  }));
  const download = vi.fn().mockResolvedValue({ error: null, data: new Blob(["abc"]) });
  const from = vi.fn(() => ({ download }));
  return { rpc, storage: { from }, download };
}

describe("trusted Gate 1 worker", () => {
  it("reads a scoped recording and completes with provider metadata and no publication flag", async () => {
    const db = database({ answerId, leaseId, kind: "voice", audio });
    const transcribe = vi.fn().mockResolvedValue({ text: "restricted synthetic text", provider: "fixture",
      model: "fixture", latencyMs: 10, costMicros: 2 });
    const createTranscriber = vi.fn(() => ({ transcribe }));
    const ports = createGate1DatabasePorts(db, { answerId, createTranscriber });
    await expect(runGate1AnswerJob(ports)).resolves.toBe("private");
    expect(db.storage.from).toHaveBeenCalledWith("gate1-interview-audio");
    expect(db.download).toHaveBeenCalledWith(audio.storagePath);
    expect(createTranscriber).toHaveBeenCalledWith(1250);
    expect(db.rpc).toHaveBeenCalledWith("complete_gate1_answer_job", {
      ...lease, supplied_raw_text: "restricted synthetic text", supplied_provider: "fixture",
      supplied_model: "fixture", supplied_latency_ms: 10, supplied_cost_micros: 2,
    });
  });

  it("completes a typed answer without passing raw text back through the RPC", async () => {
    const db = database({ answerId, leaseId, kind: "text", rawText: "private typed fixture" });
    const createTranscriber = vi.fn();
    await expect(runGate1AnswerJob(createGate1DatabasePorts(db, { answerId, createTranscriber }))).resolves.toBe("private");
    expect(db.download).not.toHaveBeenCalled();
    expect(createTranscriber).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenCalledWith("complete_gate1_answer_job", lease);
  });

  it("supplies the policy digest alongside redacted output and leaves an unversioned result private", async () => {
    const claim = { answerId, leaseId, kind: "text", rawText: "private typed fixture" };
    const policyDigest = "a".repeat(64);
    const options = { answerId, createTranscriber: vi.fn(), redact: vi.fn(async () => "Redacted output") };
    const unversioned = database(claim);
    await expect(runGate1AnswerJob(createGate1DatabasePorts(unversioned, options))).resolves.toBe("private");
    expect(unversioned.rpc).toHaveBeenCalledWith("complete_gate1_answer_job", lease);
    const versioned = database(claim);
    await runGate1AnswerJob(createGate1DatabasePorts(versioned, { ...options, policyDigest }));
    expect(versioned.rpc).toHaveBeenCalledWith("complete_gate1_answer_job", {
      ...lease, supplied_redacted_text: "Redacted output", supplied_redaction_passed: true,
      supplied_policy_digest: policyDigest,
    });
    expect(() => createGate1DatabasePorts(versioned, { ...options, policyDigest: "invalid" })).toThrow(/policy digest/);
  });

  it("rejects an out-of-scope storage locator before reading any recording", async () => {
    const db = database({ answerId, leaseId, kind: "voice", audio: { ...audio, storagePath: "unscoped/file" } });
    const createTranscriber = vi.fn();
    await expect(runGate1AnswerJob(createGate1DatabasePorts(db, { answerId, createTranscriber }))).rejects.toThrow(/invalid claim/);
    expect(db.download).not.toHaveBeenCalled();
  });

  it("processes the next eligible answer when no answer ID is supplied", async () => {
    const db = database({ answerId, leaseId, kind: "text", rawText: "synthetic queued answer" });
    const createTranscriber = vi.fn();
    await expect(runGate1AnswerJob(createGate1DatabasePorts(db, { createTranscriber }))).resolves.toBe("private");
    expect(db.rpc).toHaveBeenCalledWith("claim_gate1_answer_job", { supplied_answer_id: null });
    expect(db.rpc).toHaveBeenCalledWith("complete_gate1_answer_job", lease);
    expect(createTranscriber).not.toHaveBeenCalled();
  });

  it("returns idle for an empty queue without reading audio or calling a provider", async () => {
    const db = database(null);
    const createTranscriber = vi.fn();
    await expect(runGate1AnswerJob(createGate1DatabasePorts(db, { createTranscriber }))).resolves.toBe("idle");
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.download).not.toHaveBeenCalled();
    expect(createTranscriber).not.toHaveBeenCalled();
  });
});
