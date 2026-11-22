# ai

AI providers, prompts, redaction and evaluations.

The initial provider contracts and fixture-backed implementations support deterministic replay without credentials. The lookup uses the full LLM request or the audio bytes and media type. Missing fixtures fail explicitly.

Server jobs can construct the Anthropic, OpenAI and Groq adapters with explicit credentials, a model selection where needed, and a cost calculator based on their configured rates. `withTranscriptionFallback` switches providers for eligible provider failures. Adapter errors omit request and vendor error bodies. Server jobs must verify consent and access before sending audio to an adapter.

The OpenAI adapter defaults to the PRD's `gpt-4o-mini-transcribe`. OpenAI lists its shutdown for February 26, 2027. Update the configured model and verify it against the transcription evals before the cutoff. [OpenAI transcription documentation](https://developers.openai.com/api/docs/guides/speech-to-text)

For the Gate 1 provider smoke check, run `pnpm --filter @envoi-labs/ai transcription:smoke --preflight`. It verifies the five checked-in synthetic audio files and reports credential availability and an estimated cost without making network requests.

With an approved project credential in the process environment, run `pnpm --filter @envoi-labs/ai transcription:smoke --live openai` using `OPENAI_API_KEY`, or `pnpm --filter @envoi-labs/ai transcription:smoke --live groq` using `GROQ_API_KEY`. Each invocation sends only the five published synthetic fixtures to the selected provider. Output records the model, latency and estimated USD microdollars per fixture. The check omits transcript text, request bodies and credentials. Prices use provider-reported duration when available and the fixture duration otherwise. [OpenAI model pricing](https://developers.openai.com/api/docs/models/gpt-transcribe) · [Groq duration pricing and minimum](https://console.groq.com/docs/speech-to-text)

The live smoke pins `gpt-transcribe` or `whisper-large-v3-turbo`. A green smoke establishes real provider compatibility with these synthetic audio containers. IT-1.2 also exercises the product's consent, private storage, fallback and redaction pipeline. Keep CI on deterministic provider responses.

Run `pnpm --filter @envoi-labs/ai eval` for the offline baseline. Select `scoping`, `sizing-pushback`, `guide`, `probe`, or `evidence` to run one suite. The command prints a JSON report and exits nonzero on a failed check or missing fixture. The package test command also runs the baseline. Full fixture counts, redaction, and live model or judge runs remain tracked in the build plan.

Add prompt revisions under `prompts/<agent>/`. Update `prompts/active.json` and refresh the matching replay fixtures when switching versions.

Gate 1 CI runs the transcription preflight on the five checked-in fixtures and
a fresh Chromium recording of synthetic speech. An authorized maintainer can run
the **Gate 1 live synthetic transcription** workflow from `main` after adding
one scoped repository Actions secret, `OPENAI_API_KEY` or `GROQ_API_KEY`. The
workflow sends the six synthetic samples to the chosen provider and records
provider, model, latency and estimated cost. Logs omit transcripts and secrets.
The study's upload, consent and redacted publication checks run separately.
