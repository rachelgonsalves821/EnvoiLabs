# Scoping and guide held-out evaluation

`--synthetic` repeats fictional data to test the scorer and prints `rubricPassed: null`.
It is not independent model-quality evidence.

## Independent run

1. Freeze 25 scripted founder conversations and 25 separate complete briefs before prompt tuning. Keep their text and any identifiers in a restricted evaluation store, not this repository. Have an independent reviewer adjudicate semantic brief completeness and leading guide questions. Record disagreements and the adjudicated reviewer record.
2. Run one pinned provider/model/prompt version per conversation and per guide brief. Store the full inputs, outputs and judgments in six private JSON files. For scoping, `inputDigest` is lowercase SHA-256 of `JSON.stringify(conversation)`; for guide, it is SHA-256 of `JSON.stringify(brief)`. Copy that digest into the output and adjudicated judgment. The scorer recomputes it so a changed input cannot silently use an old result. Verify the actual provider and prompt receipts outside this aggregate scorer before treating the run as model evidence.
3. Run `node packages/ai/evals/run-scope-guide-heldout.mjs scoping-inputs.json scoping-outputs.json scoping-judgments.json guide-inputs.json guide-outputs.json guide-judgments.json`. The printed output contains only aggregate counts and rates. Never put those six files, raw conversations, full briefs or provider outputs in the PR.

Scoping input: `{ "id": "opaque-01", "conversation": [{ "role": "researcher", "content": "..." }] }`.
Output: `{ "id": "opaque-01", "inputDigest": "<64 lowercase hex>", "brief": { ...BriefSchema }, "agentMessages": ["..."], "model": "pinned-model", "promptVersion": "frozen-v1" }`.
Judgment: `{ "id": "opaque-01", "inputDigest": "<same digest>", "reviewerId": "adjudicated-record", "completeForDecision": true }`.

Guide input: `{ "id": "opaque-01", "brief": { ...BriefSchema } }`.
Output: `{ "id": "opaque-01", "inputDigest": "<64 lowercase hex>", "coreQuestions": ["..."], "model": "pinned-model", "promptVersion": "frozen-v1" }`.
Judgment: `{ "id": "opaque-01", "inputDigest": "<same digest>", "reviewerId": "adjudicated-record", "leadingQuestionIndexes": [] }`. Indexes are zero based and refer to the generated order.

The scoping rubric requires at least 23 of 25 valid complete briefs, including a target of at least ten, and zero agent price amounts. The guide rubric requires all 25 outputs to have six to eight contract-valid questions and zero independently judged leading questions. The scorer checks shape, digests and labels; it cannot independently prove that the labels are honest, the prompt was frozen, the model ran, consent was current, or the questions are semantically on the decision. Keep those external receipts with the private review record. No live model or participant input is permitted until the earlier consent and Gate 1/2 policy handoffs pass.

Smoke command: `node packages/ai/evals/run-scope-guide-heldout.mjs --synthetic`.
