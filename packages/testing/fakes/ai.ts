interface LlmRequest {
  readonly purpose: string;
  readonly promptVersion: string;
  readonly system: string;
  readonly messages: readonly { role: "user" | "assistant"; content: string }[];
}

interface LlmResponse {
  readonly output: unknown;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly costMicros: number;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function fakeLlmRequestHash(request: LlmRequest): Promise<string> {
  return sha256(new TextEncoder().encode(JSON.stringify([
    request.purpose, request.promptVersion, request.system,
    request.messages.map(({ role, content }) => [role, content]),
  ])));
}

export function fakeTranscriptionAudioHash(audio: Uint8Array<ArrayBuffer>): Promise<string> {
  return sha256(audio);
}

type LlmMode = { script: readonly LlmResponse[] } | { fixtures: ReadonlyMap<string, LlmResponse> };

export class FakeLLM {
  private readonly mode: LlmMode;
  private sequence = 0;

  constructor(mode: LlmMode) {
    this.mode = mode;
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const fixture = "script" in this.mode
      ? this.mode.script[this.sequence++]
      : this.mode.fixtures.get(await fakeLlmRequestHash(request));
    if (fixture === undefined) throw new Error("No LLM fixture matches this request.");
    return structuredClone(fixture);
  }
}

export class FakeTranscriber {
  private readonly transcripts: ReadonlyMap<string, string>;

  constructor(transcripts: ReadonlyMap<string, string>) {
    this.transcripts = transcripts;
  }

  async transcribe(request: { audio: Uint8Array<ArrayBuffer>; mediaType: string }) {
    const text = this.transcripts.get(await fakeTranscriptionAudioHash(request.audio));
    if (text === undefined) throw new Error("No transcription fixture matches this audio.");
    return { text, provider: "fixture", model: "fixture", latencyMs: 0, costMicros: 0 };
  }
}
