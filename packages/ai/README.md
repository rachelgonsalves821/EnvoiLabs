# ai

AI providers, prompts, redaction and evaluations.

The initial provider contracts and fixture-backed implementations support deterministic replay without credentials. The lookup uses the full LLM request or the audio bytes and media type. Missing fixtures fail explicitly.

Run `pnpm --filter @envoi-labs/ai eval scoping` for the offline scoping smoke check. It prints a JSON report and exits nonzero on failure. Add prompt revisions under `prompts/<agent>/` and update `prompts/active.json` after evaluation.
