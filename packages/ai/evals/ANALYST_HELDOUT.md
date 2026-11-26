# Analyst evidence held-out evaluation

The `--synthetic` run repeats ten fictional redacted studies and marks its rubric result unproved. It tests the scorer only.

## Independent ten-study run

1. Freeze ten separate approved studies with unique study IDs and current qualified redacted transcript versions. No transcript ID or immutable source version may appear twice, including across studies. Obtain independently hand-coded theme counts. Keep text, private quote rationales, IDs, review notes and provider outputs in the restricted evaluation store, outside this repository. Do not tune the analyst prompt on these studies.
2. Run one pinned model and prompt version for all ten studies. Match each candidate theme to exactly one hand label through an adjudicated reviewer record. Independently verify current consent, qualification receipts and source versions in the restricted store. The scorer's `sourceDigest` is lowercase SHA-256 of `JSON.stringify(sources)`; copy it to the model-output wrapper and judgment so changed sources cannot silently reuse an old score.
3. Run `node packages/ai/evals/run-analyst-heldout.mjs inputs.json outputs.json judgments.json`. The scorer rejects repeated study IDs, transcript IDs and source versions without regard to UUID letter case; the output reports only aggregate quote and theme counts. Never commit the three private files. File input alone cannot prove independent labels, held-out selection, actual model inference or current source qualification: the CLI prints `scoredRubricPass` but keeps `rubricPassed: null`, `gateQualified: false` and `evidence: supplied-labels-unverified`. Preserve the private frozen sampling frame, provider receipts, reviewer/adjudication trail and current qualification check for Gate 3 review. The scored threshold requires every proposed quote to match an exact Unicode span of its versioned redacted source, every model theme count to be within one of its adjudicated hand count, and every model total to equal the adjudicated hand total. An empty or unmatched theme set cannot pass.

Input row additionally needs the exact `decisionQuestion`; each source is the current qualified redacted version for that study.

Output row additionally needs `decisionQuestionDigest` (SHA-256 of the raw UTF-8 decision question) and `sourceDigest` (SHA-256 of `JSON.stringify(sources)`); the judgment must echo both.

Judgment labels identify one independently hand-coded theme each, with `handCount` and `handTotal` bound to the same qualified study population.

This offline scorer does not prove that a source is currently qualified, a participant consented, a hand label is independent, a model actually produced the output, the declared denominator is the Platform-approved complete set, or public free text is privacy safe. Gate 2's restricted publication transaction, current policy/redaction qualification, private review audit and actual researcher view/export tests remain mandatory. No live provider call or participant data is used by the synthetic smoke.

For the versioned map/reduce path, every input additionally supplies the frozen nonempty `hypotheses`, four-to-ten reviewed `guideQuestions` (`id`, `text`) and each source's bound `questionId`. The output supplies the approved map prompt version/digest, `briefDigest` over the exact decision question, hypotheses and guide array, `mapCount` and private `mapEvidence` spans (`transcriptId`, `sourceVersion`, `questionId`, Unicode offsets and exact text). The judgment echoes the brief digest. All ten studies must use one model and both prompt versions. The scorer rejects an edited brief, wrong question binding or invalid map span, and only counts a reduced quote as verified when it matches both its qualified source and a map evidence span. These records are still self-reported until the private provider and independent reviewer trail is inspected.

Smoke command: `node packages/ai/evals/run-analyst-heldout.mjs --synthetic`.
