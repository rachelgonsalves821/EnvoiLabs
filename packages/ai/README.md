# ai

AI providers, prompts, redaction and evaluations.

The initial provider contracts and fixture-backed implementations support deterministic replay without credentials. The lookup uses the full LLM request or the audio bytes and media type. Missing fixtures fail explicitly.

Server jobs can construct the Anthropic, OpenAI and Groq adapters with explicit credentials, a model selection where needed, and a cost calculator based on their configured rates. `withTranscriptionFallback` switches providers for eligible provider failures. Adapter errors omit request and vendor error bodies. Server jobs must verify consent and access before sending audio to an adapter.

The OpenAI adapter defaults to the PRD's `gpt-4o-mini-transcribe`. OpenAI lists its shutdown for February 26, 2027. Update the configured model and verify it against the transcription evals before the cutoff. [OpenAI transcription documentation](https://developers.openai.com/api/docs/guides/speech-to-text)

Run `pnpm --filter @envoi-labs/ai eval` for the offline baseline. Select `scoping`, `sizing-pushback`, `guide`, `probe`, or `evidence` to run one suite. The command prints a JSON report and exits nonzero on a failed check or missing fixture. The package test command also runs the baseline. Full fixture counts, redaction, and live model or judge runs remain tracked in the build plan.

Add prompt revisions under `prompts/<agent>/`. Update `prompts/active.json` and refresh the matching replay fixtures when switching versions.
