# Probe held-out evaluation protocol

The `--synthetic` run is a pipeline smoke test. It repeats 12 fictional scenarios across five variants and labels them in code. Its score is **not** evidence of model quality or Gate 3 acceptance.

## Real 60-answer run, after the consent and processing gates

1. Freeze 60 distinct, approved answer transcripts before running the candidate interviewer. Give each an opaque ID, core question and guide goal. Store real transcripts and identifiers in the access-controlled evaluation store, not this repository. Keep the set out of prompt tuning and development fixtures.
2. Run the pinned model and prompt version once per input. Save `outputs.json` separately from `inputs.json`, using `action` = `probe`, `next`, `error` or `timeout`; include `text` only for a probe. Record provider/prompt version, timeout and device timing in the private evaluation record. A provider failure still advances to the static guide.
3. Have independent reviewers judge decision appropriateness, whether each probe is non-leading and on-goal, and whether an observed follow-up answer was off-topic. Give each observed follow-up answer a distinct opaque `followUpAnswerId` and keep its actual text in the private review store. Record disagreements and adjudication before scoring. The scorer accepts adjudicated `judgments.json`; `reviewerId` must identify that review record. If no follow-up answer exists, the probe judgment is incomplete and the run cannot establish the PRD's zero off-topic-answer condition.
4. Run `node packages/ai/evals/run-probe-heldout.mjs inputs.json outputs.json judgments.json`. It rejects missing, duplicate or mismatched IDs and incomplete labels, and reports the 60-answer denominator, probe denominator, non-leading/on-goal numerator and rate, off-topic follow-up count, intentional no-probes, errors and timeouts. Keep raw inputs and outputs private; the printed report contains only opaque IDs and counts.

Input row: `{ "id": "opaque-001", "coreQuestion": "What happened?", "answer": "...", "guideGoal": "Checkout friction" }`.

Output row: `{ "id": "opaque-001", "action": "probe", "text": "What happened next?" }`.

Judgment row for a probe: `{ "id": "opaque-001", "reviewerId": "adjudicated-review-1", "decisionAppropriate": true, "nonLeading": true, "onGoal": true, "offTopicFollowUp": false, "followUpAnswerId": "private-answer-001" }`. For `next`, `error` or `timeout`, set `nonLeading`, `onGoal`, `offTopicFollowUp` and `followUpAnswerId` to `null`.

The rubric reports `rubricPassed` only when at least one probe exists, at least 90% of probes are judged appropriate, non-leading and on-goal, and zero off-topic follow-up answers are observed. Independently check the agreed timeout-rate limit, privacy, accessibility and rendered p95 on representative devices before fielding. A JSON score alone cannot establish independent review, valid consent, or live pilot acceptance.

Smoke test: `node packages/ai/evals/run-probe-heldout.mjs --synthetic`.
