# Probe held-out evaluation protocol

The `--synthetic` run is a pipeline smoke test. It repeats 12 fictional scenarios across five variants and labels them in code. Its CLI output sets `rubricPassed` to `null` and reports `fixtureRubricPass` separately. Its score is **not** evidence of model quality or Gate 3 acceptance.

## Real 60-answer run, after the consent and processing gates

1. Freeze 60 distinct, approved answer transcripts before running the candidate interviewer. Give each an opaque ID, core question and guide goal. Store real transcripts and identifiers in the access-controlled evaluation store, not this repository. Keep the set out of prompt tuning and development fixtures.
2. Run the pinned model and prompt version once per input. Save `outputs.json` separately from `inputs.json`, using `action` = `probe`, `next`, `error` or `timeout`; include `text` only for a probe. Record provider/prompt version, timeout and device timing in the private evaluation record. A provider failure still advances to the static guide.
3. Have independent reviewers judge decision appropriateness, whether each probe is non-leading and on-goal, and whether an observed follow-up answer was off-topic. Give each observed follow-up answer a distinct opaque `followUpAnswerId` and keep its actual text in the private review store. Export a separate private `answer-receipts.json` from that store with the same answer ID, case ID, immutable redacted source-version UUID and SHA-256 digest of the observed answer. Record disagreements and adjudication before scoring. The scorer accepts adjudicated `judgments.json`; `reviewerId` must identify that review record. If no follow-up answer receipt exists, the probe judgment is incomplete and the run cannot establish the PRD's zero off-topic-answer condition. Cross-file matching guards against accidental or invented IDs in a single judgment file; independently verify each receipt against the restricted answer store before claiming an observed result.
4. Run `node packages/ai/evals/run-probe-heldout.mjs inputs.json outputs.json judgments.json answer-receipts.json`. It rejects missing, duplicate or mismatched IDs, invalid source versions/digests and incomplete labels, and reports the 60-answer denominator, probe denominator, non-leading/on-goal numerator and rate, off-topic follow-up count, intentional no-probes, errors and timeouts. Keep raw inputs, outputs and receipts private; the printed report contains only opaque IDs and counts.

Input row: `{ "id": "opaque-001", "coreQuestion": "What happened?", "answer": "...", "guideGoal": "Checkout friction" }`.

Output row: `{ "id": "opaque-001", "action": "probe", "text": "What happened next?" }`.

Judgment row for a probe: `{ "id": "opaque-001", "reviewerId": "adjudicated-review-1", "decisionAppropriate": true, "nonLeading": true, "onGoal": true, "offTopicFollowUp": false, "followUpAnswerId": "private-answer-001" }`. For `next`, `error` or `timeout`, set `nonLeading`, `onGoal`, `offTopicFollowUp` and `followUpAnswerId` to `null`.

Answer receipt row: `{ "id": "private-answer-001", "caseId": "opaque-001", "sourceVersion": "a9700000-0000-4000-8000-000000000001", "answerDigest": "<64 lowercase hex characters>" }`. Keep the digest and source version in the private evaluation record; neither appears in scorer output.

The rubric reports `rubricPassed` only when at least one probe exists, at least 90% of probes are judged appropriate, non-leading and on-goal, and zero off-topic follow-up answers are observed. Independently check the agreed timeout-rate limit, privacy, accessibility and rendered p95 on representative devices before fielding. A JSON score alone cannot establish independent review, valid consent, or live pilot acceptance.

Smoke test: `node packages/ai/evals/run-probe-heldout.mjs --synthetic`.
