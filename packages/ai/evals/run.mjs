import { readFile } from "node:fs/promises";
import { FixtureLLMProvider } from "../src/index.ts";

const load = (path) => readFile(new URL(path, import.meta.url), "utf8");
const loadJson = async (path) => JSON.parse(await load(path));
const isText = (value) => typeof value === "string" && value.trim().length > 0;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const pricePattern = /(?:[$£€]|\b(?:USD|dollars?|cents?)\b)/i;
const leadingPattern = /^(?:don't you|wouldn't you|didn't you|isn't it)\b/i;

function checkScoping({ message, quickReplies, briefPatch }) {
  const choices = Array.isArray(quickReplies) ? quickReplies : [];
  return {
    singleShortQuestion: isText(message) && message.trim().split(/\s+/).length < 80
      && (message.match(/\?/g) ?? []).length === 1,
    replyChoices: choices.length >= 2 && choices.length <= 4 && choices.every(isText)
      && choices.includes("Something else"),
    briefPatchObject: isObject(briefPatch)
      && !Object.keys(briefPatch).some((key) => /price|payout|cost/i.test(key)),
    priceFree: !pricePattern.test([message, ...choices].join(" ")),
  };
}

function checkSizing(output) {
  const text = typeof output.message === "string" ? output.message : "";
  return {
    ...checkScoping(output),
    acknowledgesLimit: /\b(?:can't|cannot|won't|do not)\s+(?:estimate|measure|size)\b/i.test(text),
    offersQualitativeAlternative: /\b(?:why|how|experience|reasons?)\b/i.test(text),
  };
}

function checkGuide({ coreQuestions }) {
  const questions = Array.isArray(coreQuestions) ? coreQuestions : [];
  return {
    questionCount: questions.length >= 6 && questions.length <= 8,
    openQuestions: questions.every((q) => isText(q) && q.endsWith("?")
      && /^(?:what|when|where|who|why|how|can you describe)\b/i.test(q)),
    noObviousLeadingQuestions: questions.every((q) => !leadingPattern.test(q)),
  };
}

function checkProbe({ action, text }, fixture) {
  return {
    expectedAction: action === fixture.expectedAction,
    validText: action === "probe"
      ? isText(text) && text.endsWith("?") && !leadingPattern.test(text)
      : text === undefined,
  };
}

function checkEvidence({ themes }, fixture) {
  const theme = Array.isArray(themes) ? themes[0] : undefined;
  const references = theme?.supportingQuotes ?? [];
  return {
    countNearLabel: Number.isInteger(theme?.count)
      && Math.abs(theme.count - fixture.expectedCount) <= 1
      && theme.count >= 1 && theme.count <= theme.total,
    exactEvidence: Array.isArray(references) && references.length > 0
      && references.every(({ transcriptId, startChar, endChar }) => {
        const text = fixture.transcripts[transcriptId];
        return typeof text === "string" && Number.isInteger(startChar) && Number.isInteger(endChar)
          && startChar >= 0 && startChar < endChar && endChar <= text.length
          && text.slice(startChar, endChar) === fixture.expectedQuote;
      }),
  };
}

const suites = {
  scoping: { prompt: "scoping", check: checkScoping },
  "sizing-pushback": { prompt: "scoping", check: checkSizing },
  guide: { prompt: "scoping", check: checkGuide },
  probe: { prompt: "interviewer", check: checkProbe },
  evidence: { prompt: "analyst", check: checkEvidence },
};

async function evaluate(names) {
  const active = await loadJson("../prompts/active.json");
  const baseline = await loadJson("./baseline.json");
  const reports = [];
  for (const name of names) {
    const { prompt, check } = suites[name];
    const promptVersion = active[prompt];
    const system = await load("../prompts/" + prompt + "/" + promptVersion + ".md");
    const fixtures = name === "scoping" ? await loadJson("./scoping.json") : baseline[name];
    const results = [];
    for (const fixture of fixtures) {
      const provider = new FixtureLLMProvider(new Map([[fixture.requestKey, {
        output: fixture.response, model: "fixture", inputTokens: 0, outputTokens: 0, latencyMs: 0, costMicros: 0,
      }]]));
      let checks;
      try {
        const { output } = await provider.generate({ purpose: name, promptVersion, system, messages: fixture.messages });
        checks = check(output, fixture);
      } catch {
        checks = { replayed: false };
      }
      results.push({ id: fixture.id, checks, passed: Object.values(checks).every(Boolean) });
    }
    reports.push({ suite: name, passed: results.length > 0 && results.every((result) => result.passed), results });
  }
  return { mode: "fixture-replay", coverage: "baseline", passed: reports.every((report) => report.passed), suites: reports };
}

const name = process.argv[2] ?? "all";
if (name !== "all" && !Object.hasOwn(suites, name)) {
  console.error("Choose one of all, " + Object.keys(suites).join(", ") + ".");
  process.exitCode = 2;
} else {
  const report = await evaluate(name === "all" ? Object.keys(suites) : [name]);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
