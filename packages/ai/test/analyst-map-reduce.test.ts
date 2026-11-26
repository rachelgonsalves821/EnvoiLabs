import { describe, expect, it, vi } from "vitest";
import { runAnalystMapReduceDraft, screenAnalystMapReduceV2Evidence,
  type AnalystMapReduceInput } from
  "../src/analyst-map-reduce.js";
import { screenAnalystV2Evidence } from "../src/analyst-evidence-screen.js";
import type { AnalystMapReduceSnapshot } from "../src/analyst-map-reduce.js";

const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = (n: number, redactedText: string) => ({ studyId: id(1),
  transcriptId: id(n), sourceVersion: id(n + 10), questionId: id(n + 2), redactedText,
  policyDigest: "a".repeat(64), qualificationDigest: "b".repeat(64) });
const snapshot: AnalystMapReduceSnapshot = { studyId: id(1),
  hypotheses: ["A receipt helps buyers decide."],
  guideQuestions: [4, 5, 6, 7].map((n) => ({ id: id(n), text: `Question ${n}?` })),
  decisionQuestion: "Why did buyers pause?", sources: [
    source(2, "The 🥣 soup was late."), source(3, "The receipt helped."),
  ] };
const input: AnalystMapReduceInput = { studyId: id(1), providerModel: "fictional-model",
  timeoutMs: 10_000,
  mapPromptVersion: "analyst-map-v1", mapSystemPrompt: "Map fictional spans.",
  reducePromptVersion: "analyst-reduce-v3", reduceSystemPrompt: "Reduce fictional codes." };
const map = (n: number, exactText: string, startChar: number) => ({ version: 1,
  transcriptId: id(n), sourceVersion: id(n + 10), questionId: id(n + 2),
  codes: [{ label: "receipt or delay",
    hypothesis: null, startChar, endChar: startChar + Array.from(exactText).length,
    exactText }] });
const reply = (output: unknown) => ({ output, model: "fictional-model",
  inputTokens: 10, outputTokens: 5, latencyMs: 2, costMicros: 1 });
const reduce = { version: 2, executiveAnswer: "Fictional answer", themes: [],
  hypotheses: [], followUpBrief: {} };
const reviewedCandidate = { version: 2, executiveAnswer: "The fictional soup was late.",
  themes: [{ claim: "A buyer described a delivery delay", count: 1, total: 1,
    confidence: "high", supportingQuotes: [{ studyId: id(1), transcriptId: id(2),
      sourceVersion: id(12), startChar: 4, endChar: 10, exactText: "🥣 soup",
      rationale: "Private fictional explanation", confidence: 0.9 }],
    contradictingQuotes: [] }],
  hypotheses: [{ hypothesis: "A receipt helps buyers decide.", result: "untested" }],
  followUpBrief: { title: "Private next study", decision: "Which receipt is clearest?",
    hypotheses: ["A short receipt helps."], criteria: [], targetCompletes: 10,
    stimulus: null, deadlineAt: "2026-12-01T00:00:00.000Z" } };

function setup() {
  const readCurrent = vi.fn().mockResolvedValue(snapshot);
  const authorize = vi.fn().mockResolvedValue(true);
  const generate = vi.fn().mockResolvedValueOnce(reply(map(2, "🥣 soup", 4)))
    .mockResolvedValueOnce(reply(map(3, "receipt", 4)))
    .mockResolvedValueOnce(reply(reduce));
  return { port: { readCurrent, authorize }, provider: { generate },
    readCurrent, authorize, generate };
}

describe("private analyst map and reduce", () => {
  it("maps each qualified source separately and reduces validated codes only", async () => {
    const { port, provider, generate, authorize } = setup();
    const result = await runAnalystMapReduceDraft(port, provider, input);
    expect(result).toMatchObject({ output: reduce, mapCount: 2, studyId: id(1),
      inputTokens: 30, outputTokens: 15, latencyMs: 6, costMicros: 3 });
    expect(result?.sources).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("The 🥣 soup was late.");
    expect(generate).toHaveBeenCalledTimes(3);
    const requests = generate.mock.calls.map(([request]) => request);
    expect(requests.map((request) => request.purpose)).toEqual([
      "ai_analysis", "ai_analysis", "ai_analysis"]);
    expect(requests[0].messages[0].content).toContain("The 🥣 soup was late.");
    expect(requests[0].messages[0].content).not.toContain("The receipt helped.");
    expect(requests[1].messages[0].content).toContain("The receipt helped.");
    expect(requests[2].messages[0].content).toContain("🥣 soup");
    expect(requests[2].messages[0].content).not.toContain("The 🥣 soup was late.");
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "ai_analysis", promptVersion: "analyst-map-v1" }));
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "ai_analysis", promptVersion: "analyst-reduce-v3" }));
  });

  it("denies all model calls without a literal current map purpose grant", async () => {
    const { port, provider, authorize, generate } = setup();
    authorize.mockResolvedValueOnce("false");
    expect(await runAnalystMapReduceDraft(port, provider, input)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it("bounds a stalled current-purpose check before any model dispatch", async () => {
    const { port, provider, authorize, generate } = setup();
    authorize.mockImplementation(() => new Promise(() => undefined));
    expect(await runAnalystMapReduceDraft(port, provider, { ...input, timeoutMs: 1_000 }))
      .toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it("ignores a model result arriving after the overall draft deadline", async () => {
    const { port, provider, generate } = setup();
    let release: (result: ReturnType<typeof reply>) => void = () => undefined;
    generate.mockReset().mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve;
    }));
    const pending = runAnalystMapReduceDraft(port, provider, { ...input, timeoutMs: 1_000 });
    expect(await pending).toBeNull();
    release(reply(map(2, "🥣 soup", 4)));
    await Promise.resolve();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("stops before the next map when qualification changes", async () => {
    const { port, provider, readCurrent, generate } = setup();
    // Initial, two pre-map checks, post-map check, then changed second-map check.
    readCurrent.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot).mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, sources: [source(2, "changed"), snapshot.sources[1]!] });
    expect(await runAnalystMapReduceDraft(port, provider, input)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("rejects a fabricated or mislocated Unicode map span before reduction", async () => {
    const { port, provider, generate } = setup();
    generate.mockReset().mockResolvedValue(reply(map(2, "🥣 soup", 5)));
    expect(await runAnalystMapReduceDraft(port, provider, input)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("rejects a code bound to another question or an invented hypothesis", async () => {
    const { port, provider, generate } = setup();
    generate.mockReset().mockResolvedValue(reply({ ...map(2, "🥣 soup", 4), questionId: id(7) }));
    expect(await runAnalystMapReduceDraft(port, provider, input)).toBeNull();
    generate.mockReset().mockResolvedValue(reply({ ...map(2, "🥣 soup", 4),
      codes: [{ ...map(2, "🥣 soup", 4).codes[0], hypothesis: "Invented" }] }));
    expect(await runAnalystMapReduceDraft(port, provider, input)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("does not reduce after the reviewed brief changes without changing transcript text", async () => {
    const { port, provider, readCurrent, generate } = setup();
    let calls = 0;
    readCurrent.mockImplementation(async () => ++calls >= 8
      ? { ...snapshot, guideQuestions: snapshot.guideQuestions.map((question, index) =>
        index === 0 ? { ...question, text: "A changed question?" } : question) }
      : snapshot);
    expect(await runAnalystMapReduceDraft(port, provider, input)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("stops reduction after a current grant is withdrawn", async () => {
    const { port, provider, authorize, generate } = setup();
    let calls = 0;
    authorize.mockImplementation(async () => ++calls < 7);
    expect(await runAnalystMapReduceDraft(port, provider, input)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("drops a completed draft if the source changes during reduction", async () => {
    const { port, provider, readCurrent, generate } = setup();
    generate.mockReset().mockImplementationOnce(async () => reply(map(2, "🥣 soup", 4)))
      .mockImplementationOnce(async () => reply(map(3, "receipt", 4)))
      .mockImplementationOnce(async () => {
        readCurrent.mockResolvedValue({ ...snapshot,
          sources: [snapshot.sources[0]!, source(3, "A different receipt.")] });
        return reply(reduce);
      });
    expect(await runAnalystMapReduceDraft(port, provider, input)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("screens a private mapped draft only under its current frozen brief", async () => {
    const { port, provider, readCurrent, generate } = setup();
    generate.mockReset().mockResolvedValueOnce(reply(map(2, "🥣 soup", 4)))
      .mockResolvedValueOnce(reply(map(3, "receipt", 4)))
      .mockResolvedValueOnce(reply(reviewedCandidate));
    const draft = await runAnalystMapReduceDraft(port, provider, input);
    expect(draft).not.toBeNull();
    const screened = await screenAnalystMapReduceV2Evidence(port, draft!);
    expect(screened?.themes).toMatchObject([{ position: 1,
      supportingQuotes: [{ exactText: "🥣 soup", sourceVersion: id(12) }] }]);
    expect(JSON.stringify(screened)).not.toContain("Private fictional explanation");
    expect(JSON.stringify(screened)).not.toContain("The fictional soup was late.");
    expect((await screenAnalystV2Evidence(port, draft!))?.themes).toHaveLength(1);
    const invented = { ...draft!, output: { ...reviewedCandidate,
      hypotheses: [{ hypothesis: "Invented hypothesis", result: "supported" }] } };
    expect(await screenAnalystV2Evidence(port, invented)).toBeNull();
    const uncoded = { ...draft!, output: { ...reviewedCandidate,
      themes: [{ ...reviewedCandidate.themes[0]!, supportingQuotes: [{
        ...reviewedCandidate.themes[0]!.supportingQuotes[0]!, startChar: 0,
        endChar: 3, exactText: "The" }] }] } };
    expect(await screenAnalystMapReduceV2Evidence(port, uncoded)).toBeNull();
    expect(await screenAnalystV2Evidence(port, uncoded)).toBeNull();
    readCurrent.mockResolvedValue({ ...snapshot, guideQuestions: snapshot.guideQuestions.map(
      (question, index) => index === 0 ? { ...question, text: "Edited question?" } : question) });
    expect(await screenAnalystMapReduceV2Evidence(port, draft!)).toBeNull();
    expect(await screenAnalystV2Evidence(port, draft!)).toBeNull();
  });

  it("withholds mapped evidence after question rebind or map grant withdrawal", async () => {
    const { port, provider, readCurrent, authorize, generate } = setup();
    generate.mockReset().mockResolvedValueOnce(reply(map(2, "🥣 soup", 4)))
      .mockResolvedValueOnce(reply(map(3, "receipt", 4)))
      .mockResolvedValueOnce(reply(reviewedCandidate));
    const draft = await runAnalystMapReduceDraft(port, provider, input);
    expect(draft).not.toBeNull();
    readCurrent.mockResolvedValue({ ...snapshot, sources: [
      { ...snapshot.sources[0]!, questionId: id(7) }, snapshot.sources[1]!] });
    expect(await screenAnalystMapReduceV2Evidence(port, draft!)).toBeNull();
    readCurrent.mockResolvedValue(snapshot);
    authorize.mockResolvedValue(false);
    expect(await screenAnalystMapReduceV2Evidence(port, draft!)).toBeNull();
    expect(await screenAnalystV2Evidence(port, draft!)).toBeNull();
  });

  it("withholds a screened quote when the source changes after the inner evidence check", async () => {
    const { port, provider, readCurrent, authorize, generate } = setup();
    generate.mockReset().mockResolvedValueOnce(reply(map(2, "🥣 soup", 4)))
      .mockResolvedValueOnce(reply(map(3, "receipt", 4)))
      .mockResolvedValueOnce(reply(reviewedCandidate));
    const draft = await runAnalystMapReduceDraft(port, provider, input);
    expect(draft).not.toBeNull();
    let calls = 0;
    authorize.mockImplementation(async () => {
      if (++calls === 5) readCurrent.mockResolvedValue({ ...snapshot,
        sources: [{ ...snapshot.sources[0]!, redactedText: "Different qualified text." },
          snapshot.sources[1]!] });
      return true;
    });
    expect(await screenAnalystMapReduceV2Evidence(port, draft!)).toBeNull();
  });
});
