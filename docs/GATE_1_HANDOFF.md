# Gate 1 handoff

Start after Platform records Gate 0 sign-off in [STATUS](STATUS.md) and updates [goal #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4). Use the [build plan](BUILD_PLAN.md#gate-1-vertical-slice-end-of-week-3) for the Gate 1 exit criteria.

| Owner | First PRs | Shared handoffs |
| --- | --- | --- |
| Agent 1, Platform | Confirm the frozen four-question study contract. Implement audited state transitions, seeded matching and invites, and the signed upload, confirmation and expiry services in separate PRs. | Provide stable answer IDs and job event keys. Agree on expected concurrency, expiry and retry results with both clients. |
| Agent 2, Respondent | Implement profile and consent, then invite acceptance, one-question voice or typed answers, and resume from the first unanswered question. | Use the agreed storage and confirmation APIs. Verify microphone denial, typed fallback, recording retry and resume with the same seeded study. |
| Agent 3, Researcher and AI | Implement a four-question study form and tracking. Implement transcription with synthetic fixtures and a live-provider smoke run, the Presidio evaluation and researcher-safe transcript publication. Complete the OpenInterviewer review for Gate 2. | Consume versioned events. Agree with Platform on private intake and redaction for typed answers. Surface processing states and publish through the existing tenant- and consent-scoped transcript view. |

Start from the merged four-question contract. The [journey map](BUILD_PLAN.md#where-to-see-each-journey) names the running routes and the screens to deliver next. Keep fixtures synthetic and the payment bypass confined to non-production. Exercise the complete flow in IT-1.1, transcription and redaction in IT-1.2, crash and resume in IT-1.3, expiry in IT-1.4, and concurrency, job retry and fail-closed publication in IT-1.5.

## Acceptance preparation

| Check | Scenario to prove |
| --- | --- |
| IT-1.1 | Use separate researcher and respondent browsers. Create and launch a four-question study with the test payment bypass. Match and invite an eligible seeded respondent under the cap. Complete profile and consent, answer four questions, submit, and confirm updated tracking, redacted transcripts and quality hold. |
| IT-1.2 | Exercise synthetic WebM/Opus, MP4/AAC and WAV fixtures plus a recording made with the browser. Run primary success, timeout with fallback, microphone denial, typed intake and denied consent. Record provider and model metadata from the live synthetic run. |
| IT-1.3 | Save two answers and close the interview. Reopen the authorized resume link at question three. A retry of answer two keeps the progress count stable. |
| IT-1.4 | Advance the test clock 24 hours. Run expiry twice. An active session becomes abandoned once and a submitted session remains intact. |
| IT-1.5 | Race launch, invite acceptance and answer confirmation. Retry job delivery after a dispatch error. Pending or failed redaction denies researcher access. Withdraw consent during a job and confirm the job cannot publish. |

The shared confirmation service must persist the answer, the audit and the durable job marker together. Resolve typed answers from a restricted record and route the identifier through the redaction job. Recheck consent and the transcript version before researcher publication.

## Initial upstream evaluation

Five synthetic recordings were decoded and checksummed in preparation for the slice. The recordings cover WebM/Opus, MP4/AAC and WAV. The live transcription check remains part of IT-1.2.

The offline evaluation of Presidio 2.2.366 and spaCy English small 3.8.0 used 100 fictional snippets. At a score threshold of 0.35, the first pass fully removed 12 of 18 phones, 15 of 18 emails, 17 of 18 names, 13 of 18 employers and none of 18 full addresses. Four of ten clean snippets were altered.

A second, 35-snippet comparison added patterns for formatted and spoken North American contact information. They raised complete redaction from 4/5 to 5/5 for phones, from 3/5 to 5/5 for emails, and from 0/5 to 4/5 for addresses. They did not improve names or employers. Three of ten clean snippets were still altered. Use a separate labeled corpus with speech-to-text outputs and evaluate the contextual pass before authorizing publication.

The initial OpenInterviewer review considered its clarification probes, save-before-analysis sequencing and evidence selection at MIT-licensed revision `8e020691798cfcbeddbf76dbf8e4a0a1f4e06d0d`. Record the adopt or skip decision before implementing the live interviewer. The review used no upstream code in Envoi.
