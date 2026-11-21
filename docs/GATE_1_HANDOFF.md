# Gate 1 handoff

Start after Platform records Gate 0 sign-off in [STATUS](STATUS.md) and updates [goal #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4). Use the [build plan](BUILD_PLAN.md#gate-1-vertical-slice-end-of-week-3) for the Gate 1 exit criteria.

| Owner | First PRs | Shared handoffs |
| --- | --- | --- |
| Agent 1, Platform | Confirm the frozen four-question study contract. Implement audited state transitions, seeded matching and invites, and the signed upload, confirmation and expiry services in separate PRs. | Provide stable answer IDs and job event keys. Agree on expected concurrency, expiry and retry results with both clients. |
| Agent 2, Respondent | Implement profile and consent, then invite acceptance, one-question voice or typed answers, and resume from the first unanswered question. | Use the agreed storage and confirmation APIs. Verify microphone denial, typed fallback, recording retry and resume with the same seeded study. |
| Agent 3, Researcher and AI | Implement a four-question study form and tracking. Implement transcription with synthetic fixtures and a live-provider smoke run, the Presidio evaluation and researcher-safe transcript publication. Complete the OpenInterviewer review for Gate 2. | Consume versioned events. Agree with Platform on private intake and redaction for typed answers. Surface processing states and publish through the existing tenant- and consent-scoped transcript view. |

Start from the merged four-question contract. The [journey map](BUILD_PLAN.md#where-to-see-each-journey) names the running routes and the screens to deliver next. Keep fixtures synthetic and the payment bypass confined to non-production. Exercise the complete flow in IT-1.1, transcription and redaction in IT-1.2, crash and resume in IT-1.3, expiry in IT-1.4, and concurrency, job retry and fail-closed publication in IT-1.5.
