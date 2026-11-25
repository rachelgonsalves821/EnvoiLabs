import { expect, it, vi } from "vitest";
import { runAnalystDraft, type AnalystSourceSnapshot } from "../src/analyst-draft.js";
import { screenAnalystV2Evidence } from "../src/analyst-evidence-screen.js";
import type { LLMProvider } from "../src/index.js";

const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const snapshot: AnalystSourceSnapshot = { studyId: id(1),
  decisionQuestion: "Why did fictional buyers pause?", sources: [{
    studyId: id(1), transcriptId: id(2), sourceVersion: id(3),
    redactedText: "A fictional buyer compared delivery options.",
    policyDigest: "a".repeat(64), qualificationDigest: "b".repeat(64),
  }] };
const quote = { studyId: id(1), transcriptId: id(2), sourceVersion: id(3),
  startChar: 2, endChar: 11, exactText: "fictional", confidence: 0.9,
  rationale: "Private explanation from model: Ada's phone 555-0100." };
const output = { version: 2, executiveAnswer: "Private draft: Ada paused.",
  themes: [{ claim: "Ada had a reason", count: 1, total: 1, confidence: "low",
    supportingQuotes: [quote], contradictingQuotes: [] }],
  hypotheses: [{ hypothesis: "Ada might return", result: "untested" }],
  followUpBrief: { title: "Private draft" } };
const input = { studyId: id(1), providerModel: "fictional-model",
  promptVersion: "analyst-v2", systemPrompt: "Use exact redacted spans." };

async function draftWith(value: unknown = output) {
  const readCurrent = vi.fn().mockResolvedValue(snapshot);
  const authorize = vi.fn().mockResolvedValue(true);
  const port = { readCurrent, authorize };
  const provider = { generate: vi.fn().mockResolvedValue({ output: value,
    model: "fictional-model", inputTokens: 10, outputTokens: 20,
    latencyMs: 1, costMicros: 0 }) } as LLMProvider;
  const draft = await runAnalystDraft(port, provider, input);
  expect(draft).not.toBeNull();
  return { draft: draft!, port, readCurrent, authorize };
}

it("grounds V2 candidates and removes private model text from the evidence screen", async () => {
  const { draft, port } = await draftWith({ ...output, themes: [{ ...output.themes[0],
    supportingQuotes: [quote, { ...quote, exactText: "fabricated" }] }] });
  const screened = await screenAnalystV2Evidence(port, draft);
  expect(screened?.themes).toMatchObject([{ position: 1,
    supportingQuotes: [{ exactText: "fictional", sourceVersion: id(3) }] }]);
  expect(screened?.decisions.map((item) => item.action)).toEqual(["accept", "drop"]);
  expect(JSON.stringify(screened)).not.toContain("Ada");
  expect(JSON.stringify(screened)).not.toContain("555-0100");
});

it("drops a finding with no current supporting quote", async () => {
  const { draft, port } = await draftWith({ ...output, themes: [{ ...output.themes[0],
    supportingQuotes: [{ ...quote, exactText: "fabricated" }] }] });
  expect(await screenAnalystV2Evidence(port, draft)).toMatchObject({ themes: [],
    decisions: [{ action: "drop", reason: "quote differs from redacted source" }] });
});

it("rejects V1, malformed candidates and missing private V2 structure", async () => {
  for (const value of [{ ...output, version: 1 },
    { ...output, themes: [{ ...output.themes[0], supportingQuotes: [null] }] },
    { ...output, followUpBrief: undefined }]) {
    const { draft, port } = await draftWith(value);
    expect(await screenAnalystV2Evidence(port, draft)).toBeNull();
  }
});

it("rejects a model confidence label below its PRD respondent-share floor", async () => {
  for (const [count, total, confidence, accepted] of [
    [5, 10, "high", false], [6, 10, "high", true],
    [2, 10, "medium", false], [3, 10, "medium", true],
    [1, 10, "low", true],
  ] as const) {
    const candidate = { ...output, themes: [{ ...output.themes[0],
      count, total, confidence }] };
    const { draft, port } = await draftWith(candidate);
    expect((await screenAnalystV2Evidence(port, draft)) !== null).toBe(accepted);
  }
});

it("rechecks source, question and analysis grant before screening", async () => {
  const { draft, port, readCurrent, authorize } = await draftWith();
  readCurrent.mockResolvedValueOnce({ ...snapshot, sources: [
    { ...snapshot.sources[0], sourceVersion: id(4) }] });
  expect(await screenAnalystV2Evidence(port, draft)).toBeNull();
  readCurrent.mockResolvedValueOnce({ ...snapshot, sources: [
    { ...snapshot.sources[0], redactedText: "Different text under an old version." }] });
  expect(await screenAnalystV2Evidence(port, draft)).toBeNull();
  readCurrent.mockResolvedValueOnce({ ...snapshot, sources: [
    { ...snapshot.sources[0], policyDigest: "c".repeat(64) }] });
  expect(await screenAnalystV2Evidence(port, draft)).toBeNull();
  readCurrent.mockResolvedValueOnce({ ...snapshot,
    decisionQuestion: "A different current decision" });
  expect(await screenAnalystV2Evidence(port, draft)).toBeNull();
  readCurrent.mockResolvedValueOnce(snapshot);
  authorize.mockResolvedValueOnce(false);
  expect(await screenAnalystV2Evidence(port, draft)).toBeNull();
});

it("does not accept a quote added by mutation during the authorization wait", async () => {
  const forged = { ...quote, startChar: 0, endChar: 10, exactText: "fabricated" };
  const { draft } = await draftWith({ ...output, themes: [{ ...output.themes[0],
    supportingQuotes: [forged] }] });
  const source = { ...snapshot.sources[0]! };
  const current = { ...snapshot, sources: [source] };
  const port = { readCurrent: vi.fn().mockResolvedValue(current),
    authorize: vi.fn(async () => {
      source.redactedText = "fabricated";
      return true;
    }) };
  expect(await screenAnalystV2Evidence(port, draft)).toBeNull();
  expect(source.redactedText).toBe("fabricated");
});

it("withholds if source version or analysis grant changes after authorization", async () => {
  const { draft } = await draftWith();
  const rotated = { ...snapshot, sources: [{ ...snapshot.sources[0]!, sourceVersion: id(4) }] };
  const sourcePort = { readCurrent: vi.fn().mockResolvedValueOnce(snapshot)
    .mockResolvedValueOnce(rotated), authorize: vi.fn().mockResolvedValue(true) };
  expect(await screenAnalystV2Evidence(sourcePort, draft)).toBeNull();
  expect(sourcePort.readCurrent).toHaveBeenCalledTimes(2);
  const grantPort = { readCurrent: vi.fn().mockResolvedValue(snapshot),
    authorize: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) };
  expect(await screenAnalystV2Evidence(grantPort, draft)).toBeNull();
  expect(grantPort.authorize).toHaveBeenCalledTimes(2);
});

it("screens the original candidate when its model output mutates during authorization", async () => {
  const candidate = { ...output, themes: [{ ...output.themes[0]!,
    supportingQuotes: [{ ...quote, exactText: "fabricated" }] }] };
  const { draft } = await draftWith(candidate);
  const port = { readCurrent: vi.fn().mockResolvedValue(snapshot),
    authorize: vi.fn(async () => {
      candidate.themes[0]!.supportingQuotes[0]!.exactText = "fictional";
      return true;
    }) };
  expect(await screenAnalystV2Evidence(port, draft)).toMatchObject({
    themes: [], decisions: [{ action: "drop", reason: "quote differs from redacted source" }],
  });
  expect(candidate.themes[0]!.supportingQuotes[0]!.exactText).toBe("fictional");
});
