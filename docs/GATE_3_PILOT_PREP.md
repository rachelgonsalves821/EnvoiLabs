# Gate 3 pilot preparation

This is a synthetic rehearsal plan. Gate 1 redaction qualification and Gate 2 first-study decisions must pass before Gate 3 fielding.

## Probe timing evidence

For each eligible core-question answer, record upload confirmation, transcription completion, decision, and browser render times under a shared attempt ID. Classify every attempt as rendered, intentional no-probe, error or timeout. A late probe is discarded once the next question is active. Use `summarizeProbeOutcomes` for sample size, rendered p95 and separate outcome counts and rates. Time representative mobile browser recordings on physical iOS Safari and Android Chrome. Agree on an acceptable timeout rate before fielding; the six-second p95 applies from upload confirmation through browser render.

The AI-owned `decideProbe` advances to the next guide question on provider error, malformed output or timeout. Its turn ID protects against late results. The browser adapter must call `presentProbeIfCurrent` when mounting a probe and supply the same monotonic clock used at upload confirmation; the hook observes two animation frames and records render time. Count a superseded turn separately from an intentional no-probe decision. The eight-case fictional `probe-runtime` replay yields three rendered probes (p95 5,100 ms), one intentional no-probe, two errors, one timeout and one superseded turn. These fixture timings are labels, not measurements from a device or live provider.

## Report evidence and pilot record

Build the analyst from current qualified redacted projections only. Recheck every citation at report and export read time. Record candidate, accepted and dropped evidence counts and reason categories without logging transcript text. Verify theme counts against hand labels, hypotheses, confidence rules and the proposed next study on fictional fixtures. A database-backed IT-3.2 must cover deletion, withdrawal and re-redaction. The pilot record should contain the actual 30 to 50 respondent and 2 to 3 founder denominators, recruitment and consent approvals, report timing, and PRD section 12 metrics. These are unmeasured until sequential acceptance opens.

## Adapter handoff after qualified report PR #132

The following is an implementation checklist for the Gate 2 Platform transaction and the later Gate 3 report/export reader. It does not enable publication.

1. Load the report, study, ordered findings and stored quote rows in one transaction. Bind each V2 theme index (1-based) to `finding.position`, then bind that finding ID to its qualified claim and exact verified quote set. Reject a missing, duplicate, extra, reordered or other-study finding or quote. The report and all cited sources must belong to the same authorized study.
2. For each candidate, load the current Gate 1 qualified redacted projection, active policy and publication receipt, consent, withdrawal and deletion state. Verify the immutable source UUID, Unicode span and exact text. Recheck immediately before commit. A same-text re-redaction must invalidate the old UUID.
3. Store proposal provenance, private rationale, model/prompt version and actor in the restricted append-only audit. Record accept, edit or drop with causation, including rejected candidates and retry behavior. Do not return rationale or proposal metadata through the public V2 shape, report or export.
4. Qualify every public free-text field (executive answer, claim and hypothesis) with the active Gate 1 redactor. Pass the exact verified quote map and qualified output to the restricted publication RPC. If any qualification, source check, audit write or RPC assertion fails, publish nothing.
5. Read report and export through the same current-report predicate and researcher RLS view. Re-evaluate consent, deletion, source revision, active policy and the complete immutable content digest at read time. Never assemble an export from raw report/finding/quote tables or a previously authorized snapshot.
6. Database-backed IT-3.2 should exercise cross-study and swapped-position quotes, missing/extra membership, private audit visibility, PII planted in all public text fields, same-text re-redaction, consent withdrawal, deletion, policy revocation, and a change between verification and commit. API and export reads must both withhold stale content.
