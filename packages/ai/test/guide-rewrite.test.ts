import { describe, expect, it, vi } from "vitest";
import { runGuideRewrite, type CurrentGuideSnapshot } from "../src/scoping.js";
import type { LLMProvider } from "../src/index.js";

const current: CurrentGuideSnapshot = { revision: "fictional-guide-4", brief: {
  title: "Fictional checkout", decision: "Improve checkout",
  hypotheses: ["Delivery cost matters"],
  criteria: [{ kind: "must", text: "Bought online in the last 30 days" }],
  targetCompletes: 10, stimulus: null, deadlineAt: "2026-12-20T00:00:00.000Z",
}, questions: ["Wouldn't you prefer faster checkout?", "When did you last shop online?",
  "What did you look for?", "How did you compare options?"] };
const input = { revision: current.revision, index: 0, providerModel: "fictional-model",
  promptVersion: "guide-rewrite-v1", systemPrompt: "Rewrite one leading question." };
const response = { output: { question: "What happened during your last checkout?" },
  model: "fictional-model", inputTokens: 10, outputTokens: 10, latencyMs: 1, costMicros: 0 };

function setup() {
  const readCurrent = vi.fn().mockResolvedValue(current);
  const authorize = vi.fn().mockResolvedValue(true);
  const generate = vi.fn().mockResolvedValue(response);
  return { port: { readCurrent, authorize }, provider: { generate } as LLMProvider,
    readCurrent, authorize, generate };
}

describe("private versioned guide rewrite", () => {
  it("suggests one reviewed question from a current guide under a prompt-bound purpose", async () => {
    const { port, provider, readCurrent, authorize, generate } = setup();
    expect(await runGuideRewrite(port, provider, input)).toEqual({
      revision: input.revision, index: 0, question: "What happened during your last checkout?" });
    expect(readCurrent).toHaveBeenCalledTimes(3);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledWith({ purpose: "researcher_scoping",
      providerModel: "fictional-model", promptVersion: "guide-rewrite-v1",
      promptDigest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(generate.mock.calls[0]![0]).toMatchObject({ purpose: "researcher_scoping",
      promptVersion: "guide-rewrite-v1" });
    expect(generate.mock.calls[0]![0].messages[0].content).toContain('"rewriteIndex":0');
  });

  it("makes no model call after denied policy or changed current guide", async () => {
    const { port, provider, authorize, readCurrent, generate } = setup();
    authorize.mockResolvedValueOnce(false);
    expect(await runGuideRewrite(port, provider, input)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
    readCurrent.mockResolvedValueOnce(current).mockResolvedValueOnce({ ...current,
      revision: "fictional-guide-5" });
    expect(await runGuideRewrite(port, provider, input)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it("withholds a guide rewrite when the current brief falls below ten completes", async () => {
    const { port, provider, readCurrent, generate } = setup();
    readCurrent.mockResolvedValue({ ...current, brief: { ...current.brief,
      targetCompletes: 9 } });
    expect(await runGuideRewrite(port, provider, input)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects a reused mutable port object changed during authorization", async () => {
    const reused = { ...current, questions: [...current.questions] };
    const { port, provider, readCurrent, authorize, generate } = setup();
    readCurrent.mockResolvedValue(reused);
    authorize.mockImplementation(async () => { reused.questions[0] = "A different question?"; return true; });
    expect(await runGuideRewrite(port, provider, input)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it("drops a suggestion after version rotation or grant revocation during inference", async () => {
    const { port, provider, readCurrent, authorize, generate } = setup();
    readCurrent.mockResolvedValueOnce(current).mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, revision: "fictional-guide-5" });
    expect(await runGuideRewrite(port, provider, input)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
    readCurrent.mockReset().mockResolvedValue(current);
    authorize.mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await runGuideRewrite(port, provider, input)).toBeNull();
  });

  it.each([
    { question: "Wouldn't you prefer faster checkout?" },
    { question: "Would you pay $5?" },
    { question: "Tell me about your last checkout." },
    { question: `${"What happened ".repeat(40)}?` },
    { question: "What happened last time?", rationale: "private" },
  ])("rejects a leading, priced, incomplete or extra-field suggestion: %j", async (output) => {
    const { port, provider, generate } = setup();
    generate.mockResolvedValue({ ...response, output });
    expect(await runGuideRewrite(port, provider, input)).toBeNull();
  });

  it("rejects incomplete guide context and provider failures", async () => {
    const { port, provider, readCurrent, generate } = setup();
    readCurrent.mockResolvedValueOnce({ ...current, questions: current.questions.slice(0, 3) });
    expect(await runGuideRewrite(port, provider, input)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
    generate.mockRejectedValueOnce(new Error("fictional outage"));
    expect(await runGuideRewrite(port, provider, input)).toBeNull();
  });
});
