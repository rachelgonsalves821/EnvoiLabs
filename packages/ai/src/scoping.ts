import { BriefPatchSchema, BriefSchema, GuideDraftSchema, ScopingTurnSchema,
  type Brief, type BriefPatch, type GuideDraft, type ScopingTurn } from "@envoi-labs/contracts";
import type { LLMProvider, LLMRequest } from "./index.js";

export interface ScopingPort {
  /** A current researcher/provider policy decision. No live adapter is supplied by this module. */
  authorize(input: { readonly purpose: "researcher_scoping"; readonly providerModel: string;
    readonly promptVersion: string }): Promise<boolean>;
}

export interface ScopingInput {
  readonly stage: "decision" | "hypotheses" | "eligibility" | "exclusions"
    | "targetCompletes" | "stimulus" | "deadlineAt";
  readonly brief: Partial<Brief>;
  readonly messages: LLMRequest["messages"];
  readonly providerModel: string;
  readonly promptVersion: string;
  readonly systemPrompt: string;
}

const nonblank = (value: string): boolean => value.trim().length > 0;
const price = /(?:[$€£]\s*\d|\b\d+(?:\.\d+)?\s*(?:dollars?|usd|cad|cents?)\b)/i;
const patchFields: Record<ScopingInput["stage"], readonly (keyof BriefPatch)[]> = {
  decision: ["title", "decision"], hypotheses: ["hypotheses"],
  eligibility: ["criteria"], exclusions: ["criteria"],
  targetCompletes: ["targetCompletes"], stimulus: ["stimulus"],
  deadlineAt: ["deadlineAt"],
};

function validInput(input: ScopingInput): boolean {
  return Object.hasOwn(patchFields, input.stage)
    && BriefPatchSchema.safeParse(input.brief).success
    && Array.isArray(input.messages) && input.messages.length > 0
    && input.messages.every((message) => (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string" && nonblank(message.content))
    && nonblank(input.providerModel) && nonblank(input.promptVersion)
    && nonblank(input.systemPrompt);
}

function validTurn(turn: ScopingTurn): boolean {
  const words = turn.message.trim().split(/\s+/u);
  return words.length < 80
    && (turn.message.match(/\?/gu)?.length ?? 0) === 1
    && turn.quickReplies.some((reply) => reply.trim().toLowerCase() === "something else")
    && !price.test(turn.message) && turn.quickReplies.every((reply) => !price.test(reply));
}

function validPatch(stage: ScopingInput["stage"], previous: Partial<Brief>, patch: BriefPatch): boolean {
  if (Object.keys(patch).some((field) => !patchFields[stage].includes(field as keyof BriefPatch))) return false;
  if (!patch.criteria) return true;
  const prior = previous.criteria ?? [];
  const keep = stage === "exclusions" ? prior.filter((item) => item.kind !== "exclude") : prior;
  if (stage === "eligibility" && patch.criteria.some((item) => item.kind === "exclude")) return false;
  return keep.every((item) => patch.criteria!.some((next) => next.kind === item.kind && next.text === item.text));
}

function attributedStimulusPrice(patch: BriefPatch,
  messages: LLMRequest["messages"]): boolean {
  if (!patch.stimulus) return true;
  const amounts = [...patch.stimulus.matchAll(new RegExp(price.source, "gi"))]
    .map((match) => match[0].toLowerCase().replace(/\s+/gu, ""));
  const researcherText = messages.filter((message) => message.role === "user")
    .map((message) => message.content.toLowerCase().replace(/\s+/gu, "")).join(" ");
  return amounts.every((amount) => researcherText.includes(amount));
}

/** A private, synthetic-ready scoping turn. Platform must still authorize every real dispatch. */
export async function runScopingTurn(port: ScopingPort, provider: LLMProvider,
  input: ScopingInput): Promise<ScopingTurn | null> {
  if (!validInput(input)) return null;
  try {
    const brief = structuredClone(input.brief);
    const messages = input.messages.map(({ role, content }) => ({ role, content }));
    if (!await port.authorize({ purpose: "researcher_scoping", providerModel: input.providerModel,
      promptVersion: input.promptVersion })) return null;
    const request: LLMRequest = { purpose: "researcher_scoping", promptVersion: input.promptVersion,
      system: input.systemPrompt, messages: [...messages,
        { role: "user", content: JSON.stringify({ currentBrief: brief, currentStage: input.stage }) }] };
    const generated = await provider.generate(request);
    if (generated.model !== input.providerModel) return null;
    const turn = ScopingTurnSchema.safeParse(generated.output);
    if (!turn.success || !validTurn(turn.data)
      || !validPatch(input.stage, brief, turn.data.briefPatch)
      || !attributedStimulusPrice(turn.data.briefPatch, messages)) return null;
    const latestUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    if (/\b(?:what percent|market size|prevalence)\b/i.test(latestUser)
      && !/\b(?:cannot|can't|won't|does not)\b/i.test(turn.data.message)) return null;
    const merged = { ...brief, ...turn.data.briefPatch };
    if (!BriefPatchSchema.safeParse(merged).success) return null;
    if (!await port.authorize({ purpose: "researcher_scoping", providerModel: input.providerModel,
      promptVersion: input.promptVersion })) return null;
    return turn.data;
  } catch {
    return null;
  }
}

export interface GuideInput extends Omit<ScopingInput, "brief" | "stage"> {
  readonly brief: Brief;
}

/** A draft only. Researcher review and versioned persistence belong to the study workflow. */
export async function runGuideDraft(port: ScopingPort, provider: LLMProvider,
  input: GuideInput): Promise<GuideDraft | null> {
  if (!BriefSchema.safeParse(input.brief).success
    || !validInput({ ...input, stage: "deadlineAt" })) return null;
  try {
    const brief = structuredClone(input.brief);
    const messages = input.messages.map(({ role, content }) => ({ role, content }));
    if (!await port.authorize({ purpose: "researcher_scoping", providerModel: input.providerModel,
      promptVersion: input.promptVersion })) return null;
    const generated = await provider.generate({ purpose: "researcher_scoping",
      promptVersion: input.promptVersion, system: input.systemPrompt,
      messages: [...messages, { role: "user", content: JSON.stringify({
        completedBrief: brief, task: "draft six to eight open questions about past behavior",
      }) }] });
    if (generated.model !== input.providerModel) return null;
    const guide = GuideDraftSchema.safeParse(generated.output);
    if (!guide.success || guide.data.coreQuestions.some((question) => price.test(question)
      || !question.includes("?"))) return null;
    if (!await port.authorize({ purpose: "researcher_scoping", providerModel: input.providerModel,
      promptVersion: input.promptVersion })) return null;
    return guide.data;
  } catch {
    return null;
  }
}

export type { BriefPatch };
