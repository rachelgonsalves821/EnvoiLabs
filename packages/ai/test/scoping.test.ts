import { describe, expect, it, vi } from "vitest";
import { runGuideDraft, runScopingTurn } from "../src/scoping.js";
import type { LLMProvider } from "../src/index.js";

const base = { stage: "decision" as const, brief: {}, messages: [{ role: "user" as const,
  content: "I want to understand abandoned carts." }], providerModel: "fictional-model",
promptVersion: "scoping-v1", systemPrompt: "Ask one question." };
const turn = { message: "What decision will this study inform?",
  quickReplies: ["Change checkout", "Change shipping", "Something else"], briefPatch: {} };
const guide = { coreQuestions: ["When did you last buy online?", "What were you buying?",
  "How did you choose the store?", "What happened at checkout?",
  "What did you do next?", "How did you decide whether to return?"] };
const completeBrief = { title: "Fictional checkout study", decision: "Improve checkout",
  hypotheses: ["Delivery fees matter"], criteria: [{ kind: "must" as const,
    text: "Bought online in the last 30 days" }], targetCompletes: 10,
  stimulus: null, deadlineAt: "2026-12-20T00:00:00.000Z" };

function setup(output: unknown = turn) {
  const authorize = vi.fn().mockResolvedValue(true);
  const generate = vi.fn().mockResolvedValue({ output, model: "fictional-model",
    inputTokens: 1, outputTokens: 1, latencyMs: 1, costMicros: 0 });
  return { port: { authorize }, provider: { generate } as LLMProvider, authorize, generate };
}

describe("fictional researcher scoping boundary", () => {
  it("sends the current brief and chat only after purpose authorization", async () => {
    const { port, provider, authorize, generate } = setup({ ...turn,
      briefPatch: { decision: "Change checkout" } });
    expect(await runScopingTurn(port, provider, base)).toMatchObject({
      briefPatch: { decision: "Change checkout" }, quickReplies: turn.quickReplies });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledWith({ purpose: "researcher_scoping",
      providerModel: "fictional-model", promptVersion: "scoping-v1" });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "researcher_scoping", promptVersion: "scoping-v1" }));
    expect(generate.mock.calls[0]![0].messages.at(-1).content)
      .toContain('"currentBrief":{},"currentStage":"decision"');
  });

  it("withholds before dispatch on missing or denied policy and after dispatch on revocation", async () => {
    const { port, provider, authorize, generate } = setup();
    authorize.mockResolvedValueOnce(false);
    expect(await runScopingTurn(port, provider, base)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
    authorize.mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await runScopingTurn(port, provider, base)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ...turn, quickReplies: ["Yes", "No"] }, "missing escape reply"],
    [{ ...turn, message: "Which decision? And when?" }, "two questions"],
    [{ ...turn, message: `${"word ".repeat(79)}?` }, "long message"],
    [{ ...turn, message: "Would $5 work?" }, "model price"],
    [{ ...turn, briefPatch: { targetCompletes: 0 } }, "invalid patch"],
    [{ ...turn, briefPatch: { targetCompletes: 10 } }, "out of order patch"],
    [{ ...turn, extra: "private text" }, "unexpected contract field"],
  ])("rejects %s (%s)", async (output) => {
    const { port, provider } = setup(output);
    expect(await runScopingTurn(port, provider, base)).toBeNull();
  });

  it("requires sizing pushback to acknowledge limits", async () => {
    const sizing = { ...base, messages: [{ role: "user" as const,
      content: "What percent of buyers would pay?" }] };
    const invalid = setup(turn);
    expect(await runScopingTurn(invalid.port, invalid.provider, sizing)).toBeNull();
    const valid = setup({ ...turn, message:
      "Interviews cannot estimate prevalence. What past choice should we understand?" });
    expect(await runScopingTurn(valid.port, valid.provider, sizing)).not.toBeNull();
  });

  it("retains a researcher-provided price in stimulus without generating a price", async () => {
    const { port, provider } = setup({ ...turn, briefPatch: { stimulus: "A fictional $5 offer" } });
    expect((await runScopingTurn(port, provider, { ...base, stage: "stimulus",
      messages: [{ role: "user", content: "Please show a fictional $5 offer." }] }))?.briefPatch.stimulus)
      .toBe("A fictional $5 offer");
    expect(await runScopingTurn(port, provider, { ...base, stage: "stimulus" })).toBeNull();
  });

  it("preserves earlier eligibility while asking exclusions", async () => {
    const prior = { kind: "must" as const, text: "Bought online in the last 30 days" };
    const dropping = setup({ ...turn, briefPatch: { criteria: [{ kind: "exclude",
      text: "Works for the fictional shop" }] } });
    expect(await runScopingTurn(dropping.port, dropping.provider, { ...base,
      stage: "exclusions", brief: { criteria: [prior] } })).toBeNull();
    const retaining = setup({ ...turn, briefPatch: { criteria: [prior, { kind: "exclude",
      text: "Works for the fictional shop" }] } });
    expect(await runScopingTurn(retaining.port, retaining.provider, { ...base,
      stage: "exclusions", brief: { criteria: [prior] } })).not.toBeNull();
  });

  it("drafts a shape-valid guide only from a complete brief and current authorization", async () => {
    const { port, provider, generate } = setup(guide);
    expect(await runGuideDraft(port, provider, { ...base, brief: completeBrief })).toEqual(guide);
    expect(generate.mock.calls[0]![0].messages.at(-1).content).toContain('"completedBrief"');
    expect(await runGuideDraft(port, provider, { ...base, brief: {
      ...completeBrief, hypotheses: [],
    } })).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed or priced guide", async () => {
    const short = setup({ coreQuestions: guide.coreQuestions.slice(0, 5) });
    expect(await runGuideDraft(short.port, short.provider, { ...base,
      brief: completeBrief })).toBeNull();
    const priced = setup({ coreQuestions: ["Would $5 work?", ...guide.coreQuestions.slice(1)] });
    expect(await runGuideDraft(priced.port, priced.provider, { ...base,
      brief: completeBrief })).toBeNull();
  });
});
