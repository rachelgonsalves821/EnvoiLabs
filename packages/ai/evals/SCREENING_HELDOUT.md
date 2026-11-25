# Screening interpretation held-out evaluation

`--synthetic` replays five fictional typed/synthetic-audio pairs. It checks the scorer and prints no answer text, IDs or reviewer notes. Its `rubricPassed: null` is intentional; no acceptable exclusion-error budget has been approved.

## Independent run

1. Freeze paired typed and equivalent synthetic-audio answers spanning supported, contradicted and ambiguous criteria before prompt tuning. Include invalid-provider and timeout cases. Have an independent reviewer label whether each answer supports the *frozen* criterion and attest that each pair is equivalent. Keep answer text, actual audio, source and consent receipts, provider traces, IDs and notes in a restricted store outside this repository.
2. Bind each private source to its immutable UUID version and lowercase SHA-256 digest. Use one pinned model and prompt version. Confirm current `ai_screening` authorization, rule version and source integrity in the private store; this offline scorer only checks that all three files refer to the same digest and version. Do not expose actual answers or audio to this scorer's stdout.
3. Run `node packages/ai/evals/run-screening-heldout.mjs inputs.json outputs.json judgments.json`. The CLI emits aggregate decision agreement, wrongful exclusions, ambiguous clear decisions, invalid/timeout fallbacks and typed/audio disagreements. It returns a nonzero status for an unsafe provider fallback or clear decision on an ambiguous answer. It cannot issue a passing verdict until the Platform and policy owners approve the exclusion-error budget and an actual independent run is reviewed.

Input row: `{ "id": "opaque", "pairId": "opaque-pair", "kind": "typed|synthetic_audio", "sourceVersion": "<uuid>", "sourceDigest": "<lowercase SHA-256>" }`.

Output row: `{ "id": "opaque", "sourceVersion": "<same uuid>", "sourceDigest": "<same digest>", "model": "pinned-model", "promptVersion": "frozen-v1", "observed": "supported|contradicted|clarify|review", "providerOutcome": "ok|invalid|timeout" }`.

Judgment row: `{ "id": "opaque", "sourceVersion": "<same uuid>", "sourceDigest": "<same digest>", "reviewerId": "adjudicated-record", "expected": "supported|contradicted|unclear", "equivalentToPair": true }`.

An exclusion error is a `contradicted` decision on an answer labeled `supported` or `unclear`; an unclear clear decision is either `supported` or `contradicted` on an ambiguous answer. Invalid or timed-out provider responses must resolve to `clarify` or `review`. Pair disagreement compares these two unresolved decisions as one category. This offline score does not establish actual model provenance, independent adjudication, audio equivalence, current consent or the live exclusion-error budget. A real `ai_screening` grant and approved disclosure remain prerequisites to any external inference.

Smoke: `node packages/ai/evals/run-screening-heldout.mjs --synthetic`.
