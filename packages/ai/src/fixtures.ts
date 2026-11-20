import type { LLMProvider, LLMRequest, LLMResponse, Transcriber, Transcription, TranscriptionRequest } from "./index.js";

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
