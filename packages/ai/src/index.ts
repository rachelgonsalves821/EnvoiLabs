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

export * from "./fixtures.js";
export * from "./gate1-answer-processor.js";
export * from "./providers.js";
export * from "./report-evidence.js";
export * from "./reviewed-report-bridge.js";
export * from "./report-reader.js";
export * from "./report-csv.js";
export * from "./report-ui.js";
export * from "./current-report-port.js";
export * from "./report-browser-port.js";
export * from "./probe-metrics.js";
export * from "./probe-runtime.js";
export * from "./probe-state.js";
export * from "./probe-integration.js";
export * from "./screening-evidence.js";
