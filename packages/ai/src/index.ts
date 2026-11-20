export interface LLMRequest {
  readonly purpose: string;
  readonly promptVersion: string;
  readonly system: string;
  readonly messages: readonly { role: "user" | "assistant"; content: string }[];
}

export interface LLMResponse {
  readonly output: unknown;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly costMicros: number;
}

export interface LLMProvider {
  generate(request: LLMRequest): Promise<LLMResponse>;
}

export interface TranscriptionRequest {
  readonly audio: Uint8Array<ArrayBuffer>;
  readonly mediaType: string;
}

export interface Transcription {
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly costMicros: number;
}

export interface Transcriber {
  transcribe(request: TranscriptionRequest): Promise<Transcription>;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function llmFixtureKey(request: LLMRequest): Promise<string> {
  return sha256(new TextEncoder().encode(JSON.stringify([
    request.purpose, request.promptVersion, request.system,
    request.messages.map(({ role, content }) => [role, content]),
  ])));
}

export async function transcriptionFixtureKey(request: TranscriptionRequest): Promise<string> {
  return JSON.stringify([request.mediaType, await sha256(request.audio)]);
}

export class FixtureLLMProvider implements LLMProvider {
  private readonly fixtures: ReadonlyMap<string, LLMResponse>;

  constructor(fixtures: ReadonlyMap<string, LLMResponse>) {
    this.fixtures = fixtures;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const fixture = this.fixtures.get(await llmFixtureKey(request));
    if (!fixture) throw new Error("No LLM fixture matches this request.");
    return structuredClone(fixture);
  }
}

export class FixtureTranscriber implements Transcriber {
  private readonly fixtures: ReadonlyMap<string, Transcription>;

  constructor(fixtures: ReadonlyMap<string, Transcription>) {
    this.fixtures = fixtures;
  }

  async transcribe(request: TranscriptionRequest): Promise<Transcription> {
    const fixture = this.fixtures.get(await transcriptionFixtureKey(request));
    if (!fixture) throw new Error("No transcription fixture matches this audio.");
    return structuredClone(fixture);
  }
}
