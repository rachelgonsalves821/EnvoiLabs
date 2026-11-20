import { describe, expect, it } from "vitest";
import { FixtureLLMProvider, FixtureTranscriber, llmFixtureKey, transcriptionFixtureKey } from "../src/index.js";
import type { LLMRequest } from "../src/index.js";

describe("provider fixture replay", () => {
  it("keys an LLM fixture by purpose, prompt and ordered messages", async () => {
    const request: LLMRequest = {
      purpose: "scoping",
      promptVersion: "v1",
      system: "Scope this study.",
      messages: [{ role: "user", content: "Understand abandoned carts." }],
    };
    const output = { message: "What decision are you trying to make?" };
    const fixture = {
      output, model: "fixture", inputTokens: 0, outputTokens: 0, latencyMs: 0, costMicros: 0,
    };
    const provider = new FixtureLLMProvider(new Map([[await llmFixtureKey(request), fixture]]));
    const replay = await provider.generate(request);
    expect(replay).toEqual(fixture);
    expect(replay.output).not.toBe(output);
    await expect(provider.generate({ ...request, promptVersion: "v2" })).rejects.toThrow("No LLM fixture");
    await expect(provider.generate({ ...request, system: "Guide a new study." })).rejects.toThrow("No LLM fixture");
  });

  it("matches transcription fixtures by bytes and media type", async () => {
    const request = { audio: new Uint8Array([1, 2, 3]), mediaType: "audio/wav" };
    const fixture = { text: "Fixture transcript", provider: "fixture", model: "fixture", latencyMs: 0, costMicros: 0 };
    const provider = new FixtureTranscriber(new Map([[await transcriptionFixtureKey(request), fixture]]));
    expect(await provider.transcribe({ ...request, audio: request.audio.slice() })).toEqual(fixture);
    await expect(provider.transcribe({ ...request, mediaType: "audio/webm" })).rejects.toThrow("No transcription fixture");
    await expect(provider.transcribe({ ...request, audio: new Uint8Array([4]) })).rejects.toThrow("No transcription fixture");
  });
});
