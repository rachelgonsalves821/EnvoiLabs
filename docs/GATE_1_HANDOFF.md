# Gate 1 handoff

Start after Platform records Gate 0 sign-off in [STATUS](STATUS.md) and updates [goal #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4). Use the [build plan](BUILD_PLAN.md#gate-1-vertical-slice-end-of-week-3) for the Gate 1 exit criteria.

| Owner | First PRs | Shared handoffs |
| --- | --- | --- |
| Agent 1, Platform | Confirm the frozen four-question study contract. Implement audited state transitions, seeded matching and invites, and the signed upload, confirmation and expiry services in separate PRs. | Provide stable answer IDs and job event keys. Agree on expected concurrency, expiry and retry results with both clients. |
| Agent 2, Respondent | Implement profile and consent, then signed-in Home for eligible invites and in-progress studies. Add invite acceptance, one-question voice or typed answers, and resume from the first unanswered question. | Use the agreed storage and confirmation APIs. Verify microphone denial, typed fallback, recording retry and resume with the same seeded study. |
| Agent 3, Researcher and AI | Implement a four-question study form and tracking. Implement transcription with synthetic fixtures and a live-provider smoke run, the Presidio evaluation and researcher-safe transcript publication. Complete the OpenInterviewer review for Gate 2. | Consume versioned events. Agree with Platform on private intake and redaction for typed answers. Surface processing states and publish through the existing tenant- and consent-scoped transcript view. |

Start from the merged four-question contract. The [journey map](BUILD_PLAN.md#where-to-see-each-journey) names the running routes and the screens to deliver next. Keep fixtures synthetic and the payment bypass confined to non-production. Exercise the complete flow in IT-1.1, transcription and redaction in IT-1.2, crash and resume in IT-1.3, expiry in IT-1.4, and concurrency, job retry and fail-closed publication in IT-1.5.

## Acceptance preparation

| Check | Scenario to prove |
| --- | --- |
| IT-1.1 | Use separate researcher and respondent browsers. Create and launch a four-question study with the test payment bypass. Match and invite an eligible seeded respondent under the cap. Complete profile and consent. Open Home and verify the eligible invite appears and another respondent's invite stays private. Accept, answer four questions, submit, and confirm updated tracking, redacted transcripts and quality hold. Request and open a new one-time email link in a fresh session. Verify it opens the same account and saved study state. |
| IT-1.2 | Exercise synthetic WebM/Opus, MP4/AAC and WAV fixtures plus a recording made with the browser. Run primary success, timeout with fallback, microphone denial, typed intake and denied consent. Record provider and model metadata from the live synthetic run. |
| IT-1.3 | Save two answers and close the interview. Reopen the authorized resume link at question three. A retry of answer two keeps the progress count stable. |
| IT-1.4 | Advance the test clock 24 hours. Run expiry twice. An active session becomes abandoned once and a submitted session remains intact. |
| IT-1.5 | Race launch, invite acceptance and answer confirmation. Retry job delivery after a dispatch error. Pending or failed redaction denies researcher access. Withdraw consent during a job and confirm the job cannot publish. |

The shared confirmation service must persist the answer, the audit and the durable job marker together. Resolve typed answers from a restricted record and route the identifier through the redaction job. Recheck consent and the transcript version before researcher publication.

## Hosted publication rehearsal

Run the rehearsal after an independent qualification meets the PRD thresholds and the evidence-preservation review. Record the protected preview deployment revision, the applied preview database migrations, the approved policy digest and the exact passing report SHA-256. The [private worker instructions](../packages/ai/evals/redaction/contextual/spoken_v3/README.md#private-worker-handoff) describe the matching runtime and model checks. Link the [Presidio evaluation and adoption decision](adr/0003-presidio-transcript-redaction-evaluation.md) in the final evidence.

1. Pause only the preview's private answer drain and allow in-flight claims to settle before submitting test answers. Keep invite expiry running. The scheduled drain has no qualified redactor and finishes claimed answers privately.
2. Have the trusted database operator register the exact policy and report digests on the dedicated preview. Start a fresh synthetic four-question study with a controlled researcher and respondent. Verify the initial locked researcher view and the respondent's current recording, transcription, retention and researcher-access choices.
3. Run the qualified worker for the selected answer IDs on the trusted host. Exercise voice and typed answers and confirm the tracking page shows the resulting redacted transcripts after researcher MFA. Check that the answer is private when consent is missing, that current withdrawal removes an existing projection, and that another organization cannot read it.
4. Record timestamps, provider and model metadata, aggregate result counts, and build and qualification fingerprints in [goal #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4) and [STATUS](STATUS.md). Keep transcript text and credentials in the protected environment. Revoke temporary rehearsal access and restore the intended preview drain state.

## Initial upstream evaluation

Five synthetic recordings were decoded and checksummed in preparation for the slice. The recordings cover WebM/Opus, MP4/AAC and WAV. IT-1.2 also has a [live provider smoke](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/45280585136) and [hosted private worker evidence](STATUS.md#2026-11-23--gate-1-hosted-scheduler-and-speech-verification).

The offline evaluation of Presidio 2.2.366 and spaCy English small 3.8.0 used 100 fictional snippets. At a score threshold of 0.35, the first pass fully removed 12 of 18 phones, 15 of 18 emails, 17 of 18 names, 13 of 18 employers and none of 18 full addresses. Four of ten clean snippets were altered.

A second, 35-snippet comparison added patterns for formatted and spoken North American contact information. They raised complete redaction from 4/5 to 5/5 for phones, from 3/5 to 5/5 for emails, and from 0/5 to 4/5 for addresses. They did not improve names or employers. Three of ten clean snippets were still altered. Use a separate labeled corpus with speech-to-text outputs and evaluate the contextual pass before authorizing publication.

The initial OpenInterviewer review considered its clarification probes, save-before-analysis sequencing and evidence selection at MIT-licensed revision `8e020691798cfcbeddbf76dbf8e4a0a1f4e06d0d`. Record the adopt or skip decision before implementing the live interviewer. The review used no upstream code in Envoi.
