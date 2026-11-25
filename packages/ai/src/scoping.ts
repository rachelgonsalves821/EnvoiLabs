import { BriefPatchSchema, BriefSchema, GuideDraftSchema, ScopingTurnSchema,
  type Brief, type BriefPatch, type GuideDraft, type ScopingTurn } from "@envoi-labs/contracts";
import type { LLMProvider, LLMRequest } from "./index.js";

export interface ScopingPort {
  /** A current researcher/provider policy decision. No live adapter is supplied by this module. */
  authorize(input: { readonly purpose: "researcher_scoping"; readonly providerModel: string;
    readonly promptVersion: string; readonly promptDigest: string }): Promise<boolean>;
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

const nonblank = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const price = /(?:[$€£]\s*\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:dollars?|usd|cad|cents?)\b)/i;
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
  if (patch.targetCompletes !== undefined && patch.targetCompletes < 10) return false;
  if (!patch.criteria) return true;
  const prior = previous.criteria ?? [];
  const keep = stage === "exclusions" ? prior.filter((item) => item.kind !== "exclude") : prior;
  if (stage === "eligibility" && patch.criteria.some((item) => item.kind === "exclude")) return false;
  return keep.every((item) => patch.criteria!.some((next) => next.kind === item.kind && next.text === item.text));
}

function attributedPatchPrices(patch: BriefPatch,
  messages: LLMRequest["messages"]): boolean {
  const amounts = [...JSON.stringify(patch).matchAll(new RegExp(price.source, "gi"))]
    .map((match) => match[0].toLowerCase().replace(/\s+/gu, ""));
  const researcherAmounts = new Set(messages.filter((message) => message.role === "user")
    .flatMap((message) => [...message.content.matchAll(new RegExp(price.source, "gi"))]
      .map((match) => match[0].toLowerCase().replace(/\s+/gu, ""))));
  return amounts.every((amount) => researcherAmounts.has(amount));
}

async function promptDigest(systemPrompt: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(systemPrompt)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A private, synthetic-ready scoping turn. Platform must still authorize every real dispatch. */
export async function runScopingTurn(port: ScopingPort, provider: LLMProvider,
  input: ScopingInput): Promise<ScopingTurn | null> {
  if (!validInput(input)) return null;
  try {
    const brief = structuredClone(input.brief);
    const messages = input.messages.map(({ role, content }) => ({ role, content }));
    const { stage, providerModel, promptVersion, systemPrompt } = input;
    const authorization = { purpose: "researcher_scoping" as const,
      providerModel, promptVersion, promptDigest: await promptDigest(systemPrompt) };
    if (!await port.authorize(authorization)) return null;
    const request: LLMRequest = { purpose: "researcher_scoping", promptVersion,
      system: systemPrompt, messages: [...messages,
        { role: "user", content: JSON.stringify({ currentBrief: brief, currentStage: stage }) }] };
    const generated = await provider.generate(request);
    if (generated.model !== providerModel) return null;
    const turn = ScopingTurnSchema.safeParse(generated.output);
    if (!turn.success || !validTurn(turn.data)
      || !validPatch(stage, brief, turn.data.briefPatch)
      || !attributedPatchPrices(turn.data.briefPatch, messages)) return null;
    const latestUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    if (/\b(?:what percent|market size|prevalence)\b/i.test(latestUser)
      && !/\b(?:cannot|can't|won't|does not)\b/i.test(turn.data.message)) return null;
    const merged = { ...brief, ...turn.data.briefPatch };
    if (!BriefPatchSchema.safeParse(merged).success) return null;
    if (!await port.authorize(authorization)) return null;
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
    const { providerModel, promptVersion, systemPrompt } = input;
    const authorization = { purpose: "researcher_scoping" as const,
      providerModel, promptVersion, promptDigest: await promptDigest(systemPrompt) };
    if (!await port.authorize(authorization)) return null;
    const generated = await provider.generate({ purpose: "researcher_scoping",
      promptVersion, system: systemPrompt,
      messages: [...messages, { role: "user", content: JSON.stringify({
        completedBrief: brief, task: "draft six to eight open questions about past behavior",
      }) }] });
    if (generated.model !== providerModel) return null;
    const guide = GuideDraftSchema.safeParse(generated.output);
    if (!guide.success || guide.data.coreQuestions.some((question) => price.test(question)
      || !question.includes("?"))) return null;
    if (!await port.authorize(authorization)) return null;
    return guide.data;
  } catch {
    return null;
  }
}

export type { BriefPatch };

export interface CurrentGuideSnapshot {
  readonly revision: string;
  readonly brief: Brief;
  readonly questions: readonly string[];
}

export interface GuideRewritePort extends ScopingPort {
  /** Current authorized researcher/org guide read; return null after access or version loss. */
  readCurrent(revision: string): Promise<CurrentGuideSnapshot | null>;
}

export interface GuideRewriteSuggestion {
  readonly revision: string;
  readonly index: number;
  readonly question: string;
}

const leading = /\b(?:don't you agree|wouldn't you|how much do you love|would you pay)\b/i;

function validGuideSnapshot(value: CurrentGuideSnapshot | null,
  revision: string, index: number): value is CurrentGuideSnapshot {
  return !!value && value.revision === revision && BriefSchema.safeParse(value.brief).success
    && Array.isArray(value.questions) && value.questions.length >= 4
    && value.questions.length <= 10 && index >= 0 && index < value.questions.length
    && value.questions.every((question) => typeof question === "string" && nonblank(question));
}

function copyGuide(value: CurrentGuideSnapshot): CurrentGuideSnapshot {
  return Object.freeze({ revision: value.revision,
    brief: structuredClone(value.brief),
    questions: Object.freeze([...value.questions]),
  });
}

/** Private suggestion only; Platform must compare-and-set it as an unapproved guide edit. */
export async function runGuideRewrite(port: GuideRewritePort, provider: LLMProvider,
  input: { readonly revision: string; readonly index: number; readonly providerModel: string;
    readonly promptVersion: string; readonly systemPrompt: string }): Promise<GuideRewriteSuggestion | null> {
  if (!nonblank(input.revision) || !Number.isSafeInteger(input.index) || input.index < 0
    || !nonblank(input.providerModel) || !nonblank(input.promptVersion)
    || !nonblank(input.systemPrompt)) return null;
  try {
    const first = await port.readCurrent(input.revision);
    if (!validGuideSnapshot(first, input.revision, input.index)) return null;
    const guide = copyGuide(first);
    const { revision, index, providerModel, promptVersion, systemPrompt } = input;
    const authorization = { purpose: "researcher_scoping" as const,
      providerModel, promptVersion, promptDigest: await promptDigest(systemPrompt) };
    if (!await port.authorize(authorization)) return null;
    const before = await port.readCurrent(revision);
    if (!validGuideSnapshot(before, revision, index)
      || JSON.stringify(copyGuide(before)) !== JSON.stringify(guide)) return null;
    const generated = await provider.generate({ purpose: "researcher_scoping", promptVersion,
      system: systemPrompt, messages: [{ role: "user", content: JSON.stringify({
        brief: guide.brief, questions: guide.questions, rewriteIndex: index,
        task: "Suggest one open question about the respondent's past behavior",
      }) }] });
    if (generated.model !== providerModel || !generated.output
      || typeof generated.output !== "object" || Array.isArray(generated.output)) return null;
    const output = generated.output as Record<string, unknown>;
    if (Object.keys(output).join(",") !== "question" || !nonblank(output.question)
      || output.question.trim().split(/\s+/u).length >= 80
      || !output.question.trim().endsWith("?") || price.test(output.question)
      || leading.test(output.question)) return null;
    const after = await port.readCurrent(revision);
    if (!validGuideSnapshot(after, revision, index)
      || JSON.stringify(copyGuide(after)) !== JSON.stringify(guide)
      || !await port.authorize(authorization)) return null;
    return { revision, index, question: output.question.trim() };
  } catch {
    return null;
  }
}
