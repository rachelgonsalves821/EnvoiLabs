import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createGroqTranscriber, createOpenAITranscriber, ProviderError } from "../src/providers.ts";

const fixtureRoot = new URL("../../testing/fixtures/audio/", import.meta.url);
const expectedCases = new Map([
  ["01-delivery.webm", "audio/webm"],
  ["02-price.m4a", "audio/mp4"],
  ["03-phone.webm", "audio/webm"],
  ["04-unclear.m4a", "audio/mp4"],
  ["05-email.wav", "audio/wav"],
]);
const maxFixtureBytes = 256 * 1024;
const providers = {
  openai: { model: "gpt-transcribe", key: "OPENAI_API_KEY", create: createOpenAITranscriber, minimumSeconds: 0, microsPerSecond: 75 },
  groq: { model: "whisper-large-v3-turbo", key: "GROQ_API_KEY", create: createGroqTranscriber, minimumSeconds: 10, microsPerSecond: 40_000 / 3600 },
};

class SmokeError extends Error {}

function estimatedMicros(provider, durationSeconds) {
  const seconds = Math.max(durationSeconds, provider.minimumSeconds);
  return Math.ceil(seconds * provider.microsPerSecond);
}

async function loadFixtures(root) {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  if (!Array.isArray(manifest?.cases) || manifest.cases.length !== expectedCases.size) {
    throw new SmokeError("Expected the five synthetic repository audio fixtures.");
  }

  const pending = new Map(expectedCases);
  const fixtures = [];
  for (const item of manifest.cases) {
    if (!pending.has(item?.file) || pending.get(item.file) !== item.mime
      || !Number.isFinite(item.seconds) || item.seconds <= 0 || item.seconds > 10
      || !/^[0-9a-f]{64}$/.test(item.sha256)) {
      throw new SmokeError("Synthetic fixture manifest is invalid.");
    }
    pending.delete(item.file);
    const bytes = await readFile(new URL(item.file, root));
    if (!bytes.length || bytes.length > maxFixtureBytes
      || createHash("sha256").update(bytes).digest("hex") !== item.sha256) {
      throw new SmokeError(`Synthetic fixture integrity check failed for ${item.file}.`);
    }
    fixtures.push({ file: item.file, mime: item.mime, seconds: item.seconds, audio: new Uint8Array(bytes) });
  }
  return fixtures;
}

export async function transcriptionSmoke({ mode, env = process.env, fetch, root = fixtureRoot, browser = false }) {
  if (mode !== "preflight" && !Object.hasOwn(providers, mode)) {
    throw new SmokeError("Choose --preflight, --live openai, or --live groq.");
  }
  const fixtures = await loadFixtures(root);
  if (mode !== "preflight" && !env[providers[mode].key]?.trim()) {
    throw new SmokeError(`${providers[mode].key} is required for the requested live check.`);
  }
  if (browser) {
    const source = fixtures.find(({ mime }) => mime === "audio/wav");
    const { captureBrowserAudio } = await import("./browser-audio-fixture.mjs");
    fixtures.push(await captureBrowserAudio(source.audio, env.ENVOI_SMOKE_CHROMIUM_CHANNEL));
  }
  if (mode === "preflight") {
    return {
      mode,
      fixtureCount: fixtures.length,
      files: fixtures.map(({ file, mime, seconds }) => ({ file, mime, seconds })),
      providers: Object.entries(providers).map(([provider, options]) => ({
        provider, model: options.model,
        credentialConfigured: Boolean(env[options.key]?.trim()),
        estimatedFixtureCostMicros: fixtures.reduce((cost, fixture) => cost + estimatedMicros(options, fixture.seconds), 0),
      })),
    };
  }

  const options = providers[mode];
  const apiKey = env[options.key]?.trim();
  const files = [];
  for (const fixture of fixtures) {
    const transcriber = options.create({
      apiKey, model: options.model, fetch, timeoutMs: 20_000,
      costMicros: ({ durationSeconds }) => estimatedMicros(options, durationSeconds ?? fixture.seconds),
    });
    const result = await transcriber.transcribe({ audio: fixture.audio, mediaType: fixture.mime });
    if (!result.text.trim()) throw new SmokeError(`Provider returned empty text for ${fixture.file}.`);
    files.push({
      file: fixture.file, mime: fixture.mime, provider: result.provider,
      model: result.model, latencyMs: result.latencyMs, estimatedCostMicros: result.costMicros,
    });
  }
  return { mode: "live", passed: true, files };
}

async function main(args) {
  const browser = args.at(-1) === "--browser";
  if (browser) args = args.slice(0, -1);
  let mode;
  if (args.length === 1 && args[0] === "--preflight") mode = "preflight";
  if (args.length === 2 && args[0] === "--live" && Object.hasOwn(providers, args[1])) mode = args[1];
  if (!mode) {
    console.error("Usage: node evals/transcription-smoke.mjs (--preflight | --live openai | --live groq) [--browser]");
    process.exitCode = 2;
    return;
  }

  try {
    console.log(JSON.stringify(await transcriptionSmoke({ mode, browser }), null, 2));
  } catch (error) {
    const detail = error instanceof ProviderError
      ? { provider: error.provider, kind: error.kind, status: error.status }
      : { message: error instanceof SmokeError ? error.message : "Fixture verification failed." };
    console.error(JSON.stringify({ mode, passed: false, ...detail }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
