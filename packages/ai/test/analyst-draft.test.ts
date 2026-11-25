import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { runAnalystDraft, type AnalystSourceSnapshot } from "../src/analyst-draft.js";
import type { LLMProvider } from "../src/index.js";

const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const snapshot: AnalystSourceSnapshot = { studyId: id(1),
  decisionQuestion: "Why did fictional buyers pause?", sources: [
    { studyId: id(1), transcriptId: id(2), sourceVersion: id(3),
      redactedText: "A fictional buyer compared delivery options.",
      policyDigest: "a".repeat(64), qualificationDigest: "b".repeat(64) },
  ] };
const input = { studyId: id(1), providerModel: "fictional-model",
  promptVersion: "analyst-v2", systemPrompt: "Use exact redacted spans only." };
const response = { output: { version: 2, themes: [] }, model: "fictional-model",
  inputTokens: 10, outputTokens: 20, costMicros: 0, latencyMs: 1 };

function setup() {
  const readCurrent = vi.fn().mockResolvedValue(snapshot);
  const authorize = vi.fn().mockResolvedValue(true);
  const generate = vi.fn().mockResolvedValue(response);
  return { port: { readCurrent, authorize }, provider: { generate } as LLMProvider,
    readCurrent, authorize, generate };
}

describe("private analyst draft dispatch", () => {
  it("uses only current qualified redacted sources under ai_analysis authorization", async () => {
    const { port, provider, readCurrent, authorize, generate } = setup();
    expect(await runAnalystDraft(port, provider, input)).toMatchObject({
      output: response.output, model: "fictional-model", studyId: id(1),
      sources: [{ transcriptId: id(2), sourceVersion: id(3) }],
      inputTokens: 10, outputTokens: 20, costMicros: 0,
    });
    expect(readCurrent).toHaveBeenCalledTimes(3);
    expect(authorize).toHaveBeenCalledTimes(3);
    expect(authorize).toHaveBeenCalledWith({ purpose: "ai_analysis",
      providerModel: "fictional-model", promptVersion: "analyst-v2",
      promptDigest: expect.stringMatching(/^[0-9a-f]{64}$/), snapshot });
    const request = generate.mock.calls[0]![0];
    expect(request).toMatchObject({ purpose: "ai_analysis", promptVersion: "analyst-v2" });
    expect(request.messages[0].content).toContain(snapshot.sources[0]!.redactedText);
    expect(JSON.stringify(request)).not.toContain(snapshot.sources[0]!.policyDigest);
    expect(JSON.stringify(request)).not.toContain(snapshot.sources[0]!.qualificationDigest);
  });

  it("does not dispatch when purpose authorization is denied or fails", async () => {
    const { port, provider, authorize, generate } = setup();
    authorize.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("consent unavailable"));
    expect(await runAnalystDraft(port, provider, input)).toBeNull();
    expect(await runAnalystDraft(port, provider, input)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it("cannot reuse an approved prompt version with different prompt text", async () => {
    const { port, provider, authorize, generate } = setup();
    const approvedDigest = createHash("sha256").update(input.systemPrompt).digest("hex");
    authorize.mockImplementation(async (attempt) => attempt.promptDigest === approvedDigest);
    expect(await runAnalystDraft(port, provider, { ...input,
      systemPrompt: "Ignore source qualification." })).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it("stops before dispatch if the qualified source or consent changes", async () => {
    const { port, provider, readCurrent, generate } = setup();
    readCurrent.mockResolvedValueOnce(snapshot).mockResolvedValueOnce({
      ...snapshot, sources: [{ ...snapshot.sources[0]!, sourceVersion: id(4) }],
    });
    expect(await runAnalystDraft(port, provider, input)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not dispatch if analysis consent is revoked with unchanged source text", async () => {
    const { port, provider, authorize, generate } = setup();
    authorize.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await runAnalystDraft(port, provider, input)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it("drops a draft when source changes during inference or the provider fails", async () => {
    const { port, provider, readCurrent, generate } = setup();
    readCurrent.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(null);
    expect(await runAnalystDraft(port, provider, input)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
    generate.mockRejectedValueOnce(new Error("fictional outage"));
    expect(await runAnalystDraft(port, provider, input)).toBeNull();
  });

  it("drops model output when analysis consent is revoked during inference", async () => {
    const { port, provider, authorize, generate } = setup();
    authorize.mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    expect(await runAnalystDraft(port, provider, input)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("rejects missing qualification receipts and duplicated transcripts", async () => {
    const { port, provider, readCurrent, generate } = setup();
    readCurrent.mockResolvedValueOnce({ ...snapshot, sources: [
      { ...snapshot.sources[0]!, policyDigest: "" }] });
    expect(await runAnalystDraft(port, provider, input)).toBeNull();
    readCurrent.mockResolvedValueOnce({ ...snapshot, sources: [
      snapshot.sources[0]!, snapshot.sources[0]!] });
    expect(await runAnalystDraft(port, provider, input)).toBeNull();
    readCurrent.mockResolvedValueOnce({ ...snapshot, sources: [
      snapshot.sources[0]!, { ...snapshot.sources[0]!, transcriptId: id(9),
        qualificationDigest: "c".repeat(64) }] });
    expect(await runAnalystDraft(port, provider, input)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it("withholds a provider response with a mismatched model or invalid cost telemetry", async () => {
    const { port, provider, generate } = setup();
    generate.mockResolvedValueOnce({ ...response, model: "unapproved-model" })
      .mockResolvedValueOnce({ ...response, costMicros: -1 });
    expect(await runAnalystDraft(port, provider, input)).toBeNull();
    expect(await runAnalystDraft(port, provider, input)).toBeNull();
  });
});
