import { describe, expect, it, vi } from "vitest";
import {
  createAnthropicProvider, createGroqTranscriber, createOpenAITranscriber, withTranscriptionFallback,
} from "../src/index.js";

const request = {
  purpose: "scoping",
  promptVersion: "v1",
  system: "Ask about the research decision.",
  messages: [{ role: "user", content: "Understand abandoned carts." }] as const,
};

const audio = { audio: new Uint8Array([1, 2, 3]), mediaType: "audio/webm;codecs=opus" };
const key = "synthetic-test-key";
const anthropicOptions = { apiKey: key, model: "test-model", maxTokens: 600, costMicros: () => 11 };
const transcriptionOptions = { apiKey: key, costMicros: () => 4 };

describe("Anthropic adapter", () => {
  it("sends the versioned prompt and returns structured output with usage", async () => {
    const costMicros = vi.fn(() => 11);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({
      model: "test-model-resolved", stop_reason: "end_turn",
      content: [{ type: "text", text: '{"action":' }, { type: "text", text: '"next"}' }],
      usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 5, cache_creation_input_tokens: null },
    }));
    const provider = createAnthropicProvider({
      ...anthropicOptions, fetch, costMicros, now: vi.fn().mockReturnValueOnce(12).mockReturnValueOnce(33),
    });

    expect(await provider.generate(request)).toEqual({
      output: { action: "next" }, model: "test-model-resolved",
      inputTokens: 17, outputTokens: 3, latencyMs: 21, costMicros: 11,
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init).toMatchObject({ method: "POST", redirect: "error", headers: {
      "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json",
    } });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "test-model", max_tokens: 600, system: request.system, messages: request.messages,
    });
    expect(costMicros).toHaveBeenCalledWith({
      model: "test-model-resolved", inputTokens: 12, outputTokens: 3,
      cacheReadInputTokens: 5, cacheCreationInputTokens: 0,
    });
  });

  it.each([
    ["max_tokens", '{"action":"next"}'],
    ["end_turn", "Unstructured plaintext"],
  ])("rejects truncated or malformed output (%s)", async (stopReason, text) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({
      model: "test-model", stop_reason: stopReason,
      content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 2 },
    }));
    const provider = createAnthropicProvider({ ...anthropicOptions, fetch });
    await expect(provider.generate(request)).rejects.toMatchObject({
      provider: "anthropic", kind: "invalid-response",
    });
  });

  it("does not include request or error response bodies in failures", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({ message: "private request content" }, { status: 429 }),
    );
    const provider = createAnthropicProvider({ ...anthropicOptions, fetch });
    await expect(provider.generate(request)).rejects.toMatchObject({
      provider: "anthropic", kind: "http", status: 429, message: "anthropic: http (HTTP 429).",
    });
  });
});

describe("transcription adapters", () => {
  it("sends a named form upload to OpenAI and reports token usage", async () => {
    const costMicros = vi.fn(() => 4);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({
      text: "Transcript.",
      usage: { type: "tokens", input_tokens: 12, output_tokens: 3, input_token_details: { audio_tokens: 10, text_tokens: 2 } },
    }));
    const openai = createOpenAITranscriber({ ...transcriptionOptions, fetch, costMicros });
    await expect(openai.transcribe(audio)).resolves.toMatchObject({
      provider: "openai", model: "gpt-4o-mini-transcribe", text: "Transcript.", costMicros: 4,
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init?.headers).toEqual({ Authorization: `Bearer ${key}` });
    const form = init?.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(form.get("response_format")).toBe("json");
    const file = form.get("file") as File;
    expect(file.name).toBe("audio.webm");
    expect(file.type).toBe("audio/webm");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(audio.audio);
    expect(costMicros).toHaveBeenCalledWith(expect.objectContaining({
      inputTokens: 12, outputTokens: 3, audioTokens: 10, textTokens: 2,
    }));
  });

  it("uses Groq Whisper on a transient primary failure", async () => {
    const fetchPrimary = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 502 }));
    const fetchFallback = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({
      text: "Fallback transcript.", duration: 2.5,
    }));
    const costMicros = vi.fn(() => 6);
    const provider = withTranscriptionFallback(
      createOpenAITranscriber({ ...transcriptionOptions, fetch: fetchPrimary }),
      createGroqTranscriber({ ...transcriptionOptions, fetch: fetchFallback, costMicros }),
    );

    await expect(provider.transcribe(audio)).resolves.toMatchObject({
      provider: "groq", model: "whisper-large-v3-turbo", text: "Fallback transcript.", costMicros: 6,
    });
    const [url, init] = fetchFallback.mock.calls[0] ?? [];
    expect(url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect((init?.body as FormData).get("response_format")).toBe("verbose_json");
    expect(costMicros).toHaveBeenCalledWith(expect.objectContaining({ provider: "groq", durationSeconds: 2.5 }));
  });

  it("rejects unsupported audio before either vendor is called", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const options = { ...transcriptionOptions, fetch };
    const provider = withTranscriptionFallback(createOpenAITranscriber(options), createGroqTranscriber(options));
    await expect(provider.transcribe({ ...audio, mediaType: "text/plain" })).rejects.toMatchObject({
      provider: "openai", kind: "invalid-input",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves an input rejection without sending the audio to another vendor", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 400 }));
    const fallback = vi.fn<typeof globalThis.fetch>();
    const provider = withTranscriptionFallback(
      createOpenAITranscriber({ ...transcriptionOptions, fetch }),
      createGroqTranscriber({ ...transcriptionOptions, fetch: fallback }),
    );
    await expect(provider.transcribe(audio)).rejects.toMatchObject({
      provider: "openai", kind: "http", status: 400,
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("reports timeout for an aborted request", async () => {
    const fetch: typeof globalThis.fetch = async (_, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const provider = createOpenAITranscriber({ ...transcriptionOptions, fetch, timeoutMs: 5 });
    await expect(provider.transcribe(audio)).rejects.toMatchObject({ provider: "openai", kind: "timeout" });
  });
});
