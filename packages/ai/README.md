# ai

AI providers, prompts, redaction and evaluations.

The initial provider contracts and fixture-backed implementations support deterministic replay without credentials. The lookup uses the full LLM request or the audio bytes and media type. Missing fixtures fail explicitly.

Run `pnpm --filter @envoi-labs/ai eval` for the offline baseline. Select `scoping`, `sizing-pushback`, `guide`, `probe`, or `evidence` to run one suite. The command prints a JSON report and exits nonzero on a failed check or missing fixture. The package test command also runs the baseline. Full fixture counts, redaction, and live model or judge runs remain tracked in the build plan.

Add prompt revisions under `prompts/<agent>/`. Update `prompts/active.json` and refresh the matching replay fixtures when switching versions.
