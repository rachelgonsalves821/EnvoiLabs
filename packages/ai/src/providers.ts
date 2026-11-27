import type { LLMProvider, Transcriber } from "./index.js";

type Provider = "anthropic" | "openai" | "groq";
type Failure = "configuration" | "invalid-input" | "timeout" | "transport" | "http" | "invalid-response";

export class ProviderError extends Error {
  readonly provider: Provider;
  readonly kind: Failure;
  readonly status: number | undefined;

  constructor(provider: Provider, kind: Failure, status?: number) {
    super(`${provider}: ${kind}${status === undefined ? "" : ` (HTTP ${status})`}.`);
    this.name = "ProviderError";
    this.provider = provider;
    this.kind = kind;
    this.status = status;
  }
}

interface TransportOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

function createTransport(provider: Provider, options: TransportOptions) {
  const send = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => performance.now());
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (!options.apiKey.trim() || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 4_294_967_295) {
    throw new ProviderError(provider, "configuration");
  }
  return {
    async post(endpoint: string, headers: HeadersInit, body: BodyInit) {
      const signal = AbortSignal.timeout(timeoutMs);
      const startedAt = now();
      let response: Response;
      try {
        response = await send(endpoint, { method: "POST", headers, body, signal, redirect: "error" });
        signal.throwIfAborted();
      } catch {
        throw new ProviderError(provider, signal.aborted ? "timeout" : "transport");
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new ProviderError(provider, "http", response.status);
      }
      try {
        const data: unknown = await response.json();
        signal.throwIfAborted();
        return { data, latencyMs: Math.max(0, Math.round(now() - startedAt)) };
      } catch {
        throw new ProviderError(provider, signal.aborted ? "timeout" : "invalid-response");
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function calculateCost<Usage>(provider: Provider, calculate: (usage: Usage) => number, usage: Usage): number {
  try {
    const cost = calculate(usage);
    if (isNonNegativeInteger(cost)) return cost;
  } catch {
    // A local pricing error must not expose credentials or trigger vendor fallback.
  }
  throw new ProviderError(provider, "configuration");
}

export interface AnthropicUsage {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
}

export interface AnthropicOptions extends TransportOptions {
  readonly model: string;
  readonly maxTokens: number;
  readonly costMicros: (usage: AnthropicUsage) => number;
}

export function createAnthropicProvider(options: AnthropicOptions): LLMProvider {
  const transport = createTransport("anthropic", options);
  if (!options.model.trim() || !isNonNegativeInteger(options.maxTokens) || options.maxTokens === 0) {
    throw new ProviderError("anthropic", "configuration");
  }
  return {
    async generate(request) {
      const { data, latencyMs } = await transport.post("https://api.anthropic.com/v1/messages", {
        "x-api-key": options.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      }, JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens,
        system: request.system,
        messages: request.messages.map(({ role, content }) => ({ role, content })),
      }));

      if (!isRecord(data) || typeof data.model !== "string" || !data.model
        || data.stop_reason !== "end_turn" || !Array.isArray(data.content) || !isRecord(data.usage)) {
        throw new ProviderError("anthropic", "invalid-response");
      }
      const { input_tokens: inputTokens, output_tokens: outputTokens } = data.usage;
      const cacheCreationInputTokens = data.usage.cache_creation_input_tokens ?? 0;
      const cacheReadInputTokens = data.usage.cache_read_input_tokens ?? 0;
      if (!isNonNegativeInteger(inputTokens) || !isNonNegativeInteger(outputTokens)
        || !isNonNegativeInteger(cacheCreationInputTokens) || !isNonNegativeInteger(cacheReadInputTokens)) {
        throw new ProviderError("anthropic", "invalid-response");
      }
      const usage = {
        model: data.model, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens,
      };
      const text = data.content.flatMap((block: unknown) =>
        isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []).join("");
      let output: unknown;
      try {
        output = JSON.parse(text);
      } catch {
        throw new ProviderError("anthropic", "invalid-response");
      }
      return {
        output, model: usage.model, latencyMs, outputTokens: usage.outputTokens,
        inputTokens: usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens,
        costMicros: calculateCost("anthropic", options.costMicros, usage),
      };
    },
  };
}

export interface TranscriptionUsage {
  readonly provider: "openai" | "groq";
  readonly model: string;
  readonly durationSeconds: number | undefined;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly audioTokens: number | undefined;
  readonly textTokens: number | undefined;
}

export interface TranscriptionOptions extends TransportOptions {
  readonly model?: string;
  readonly costMicros: (usage: TranscriptionUsage) => number;
}

const audioExtensions = new Map([
  ["audio/flac", "flac"], ["audio/x-flac", "flac"],
  ["audio/mpeg", "mp3"], ["audio/mp3", "mp3"],
  ["audio/mp4", "m4a"], ["video/mp4", "mp4"],
  ["audio/m4a", "m4a"], ["audio/x-m4a", "m4a"],
  ["audio/ogg", "ogg"], ["application/ogg", "ogg"],
  ["audio/wav", "wav"], ["audio/wave", "wav"], ["audio/x-wav", "wav"],
  ["audio/webm", "webm"], ["video/webm", "webm"],
]);

function tokenCount(value: unknown): number | undefined {
  return isNonNegativeInteger(value) ? value : undefined;
}

function createTranscriber(
  provider: TranscriptionUsage["provider"], options: TranscriptionOptions,
  defaultModel: string, endpoint: string, responseFormat: "json" | "verbose_json",
): Transcriber {
  const model = options.model ?? defaultModel;
  const transport = createTransport(provider, options);
  if (!model.trim()) throw new ProviderError(provider, "configuration");
  return {
    async transcribe(request) {
      const mediaType = request.mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      const extension = audioExtensions.get(mediaType);
      if (!extension || !request.audio.byteLength) throw new ProviderError(provider, "invalid-input");

      const form = new FormData();
      form.set("file", new Blob([request.audio], { type: mediaType }), `audio.${extension}`);
      form.set("model", model);
      form.set("response_format", responseFormat);
      const { data, latencyMs } = await transport.post(endpoint, { Authorization: `Bearer ${options.apiKey}` }, form);
      if (!isRecord(data) || typeof data.text !== "string") throw new ProviderError(provider, "invalid-response");
      const usage = isRecord(data.usage) ? data.usage : undefined;
      const tokenDetails = isRecord(usage?.input_token_details) ? usage.input_token_details : undefined;
      const seconds = usage?.type === "duration" ? usage.seconds : data.duration;
      const durationSeconds = typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
      return {
        text: data.text, provider, model, latencyMs,
        costMicros: calculateCost(provider, options.costMicros, {
          provider, model, durationSeconds, inputTokens: tokenCount(usage?.input_tokens),
          outputTokens: tokenCount(usage?.output_tokens), audioTokens: tokenCount(tokenDetails?.audio_tokens),
          textTokens: tokenCount(tokenDetails?.text_tokens),
        }),
      };
    },
  };
}

export function createOpenAITranscriber(options: TranscriptionOptions): Transcriber {
  return createTranscriber("openai", options, "gpt-4o-mini-transcribe", "https://api.openai.com/v1/audio/transcriptions", "json");
}

export function createGroqTranscriber(options: TranscriptionOptions): Transcriber {
  return createTranscriber("groq", options, "whisper-large-v3-turbo", "https://api.groq.com/openai/v1/audio/transcriptions", "verbose_json");
}

function canFallBack(error: unknown): error is ProviderError {
  return error instanceof ProviderError
    && (error.kind === "timeout" || error.kind === "transport" || error.kind === "invalid-response"
      || (error.kind === "http" && error.status !== undefined
        && ([404, 408, 429].includes(error.status) || error.status >= 500)));
}

function canRetryPrimary(error: ProviderError): boolean {
  return error.kind === "timeout" || error.kind === "transport" || error.kind === "invalid-response"
    || (error.kind === "http" && error.status !== undefined
      && (error.status === 408 || error.status >= 500));
}

export class TranscriptionAuthorizationError extends Error {
  constructor() {
    super("Current transcription authority unavailable.");
    this.name = "TranscriptionAuthorizationError";
  }
}

/** One bounded primary retry, then fallback. The caller must supply a fresh
 * lease/consent check for each vendor request, including the first. */
export function withTranscriptionFallback(primary: Transcriber, fallback: Transcriber): Transcriber {
  return {
    async transcribe(request, authorize) {
      const current = async () => authorize && await authorize() === true;
      if (!await current()) throw new TranscriptionAuthorizationError();
      try { return await primary.transcribe(request); }
      catch (error) {
        if (!canFallBack(error)) throw error;
        if (canRetryPrimary(error)) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (!await current()) throw new TranscriptionAuthorizationError();
          try { return await primary.transcribe(request); }
          catch (retryError) {
            if (!canFallBack(retryError)) throw retryError;
          }
        }
        if (!await current()) throw new TranscriptionAuthorizationError();
        return fallback.transcribe(request);
      }
    },
  };
}
