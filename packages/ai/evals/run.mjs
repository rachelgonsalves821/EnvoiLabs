import { readFile } from "node:fs/promises";
import { FixtureLLMProvider } from "../src/index.ts";

const name = process.argv[2];
if (name !== "scoping") {
  console.error("Usage: pnpm --filter @envoi-labs/ai eval scoping");
  process.exit(2);
}

async function load(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

const active = JSON.parse(await load("../prompts/active.json"));
const promptVersion = active.scoping;
const system = await load(`../prompts/scoping/${promptVersion}.md`);
const fixtures = JSON.parse(await load("./scoping.json"));
const results = [];

for (const { id, messages, requestKey, response } of fixtures) {
  const request = { purpose: name, promptVersion, system, messages };
  const provider = new FixtureLLMProvider(new Map([[requestKey, {
    output: response, model: "fixture", inputTokens: 0, outputTokens: 0, latencyMs: 0, costMicros: 0,
  }]]));
  const { output } = await provider.generate(request);
  const { message, quickReplies } = output;
  const checks = {
    singleShortQuestion: message.trim().split(/\s+/).length < 80
      && (message.match(/\?/g) ?? []).length === 1,
    replyChoices: quickReplies.length >= 2 && quickReplies.length <= 4
      && quickReplies.includes("Something else"),
    priceFree: !/(?:[$€£]|\b(?:USD|dollars?|cents?)\b)/i.test([message, ...quickReplies].join(" ")),
  };
  results.push({ id, checks, passed: Object.values(checks).every(Boolean) });
}

const passed = results.length > 0 && results.every((result) => result.passed);
console.log(JSON.stringify({ suite: name, mode: "fixture-replay", passed, results }, null, 2));
if (!passed) process.exitCode = 1;
