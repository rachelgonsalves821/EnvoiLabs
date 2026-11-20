# Envoi Labs build plan audit

Reviewed November 20, 2026 against EnvoiLabs main at `9fc79270`, the Envoi Research build kit and its standalone plan. The two supplied copies of the plan have the same SHA-256 hash. GitHub's build/browser, database and local auth workflows passed on the reviewed commit. Hosted auth and live provider behavior remain unverified in this audit. [Build and browsers](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44725313227) · [Database](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44725313291) · [Local auth](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44725313317)

## Score for the supplied plan

| Dimension | Score | Rationale |
| --- | ---: | --- |
| Product scope and ownership | 18/20 | Clear PRD, ownership and contract process. Several handoffs disagree on timing or behavior. |
| Architecture and testability | 16/20 | Typed contracts, fakes and gate tests fit the product. The plan underspecifies concurrent writes, job recovery and end-to-end access boundaries. |
| Schedule and dependencies | 10/15 | The eight-week plan sequences the major work. Hosted access blocks Gate 0 and external provider, recruiting and payout dependencies lack enough lead time. |
| Privacy and payment readiness | 10/15 | Redaction and sandbox checks are planned. The first real study precedes several privacy checks, and financial examples omit concurrent or uncertain settlement. |
| AI quality and evidence | 13/20 | Concrete thresholds for probes, redaction and quotes. Replay needs held-out live evidence, and the latency budget must include device delivery. |
| Operations and economics | 8/10 | Debt review, chaos checks and runbooks are specified. Cost per complete should include vendor use, replacement and refund effects. |
| **Total** | **75/100** | Suitable for continuing the build once the gate criteria and pilot prerequisites are corrected. |

## Findings and changes

1. **Finish Gate 0 from the code already on main.** The repo has the workspace, migrations, contract distribution, auth, UI foundations and AI fixtures. Keep the two hosted sign-in journeys and the complete checklist as the acceptance gate. The ZIP's setup prompts and initial scaffold are historical. [Status](STATUS.md) · [Hosted verification](../README.md#verify-sign-in-on-the-hosted-preview)
2. **Prove a narrow slice before adding breadth.** Align four core questions with the PRD minimum, use synthetic recordings, and verify a failed job dispatch, concurrent state changes and pending redaction in Gate 1. The guide generator still aims for six to eight questions.
3. **Treat real respondent processing as a prerequisite for Gate 2 fielding.** Confirm cohort, consent, vendor handling, withdrawal and deletion, probe display, supported mobile recording and compensation before enrollment. Gate 3 still owns the broader pilot and full privacy feature set. Rachel's open product and counsel questions apply when relevant to the proposed cohort and processing.
4. **Separate replay from quality evidence.** The current eval runner reports a fixture baseline with six examples across five suites and no redaction suite. Require held-out measurements, count timeouts separately and bind published quotes to a redacted transcript version. Evaluate Presidio, OpenInterviewer and OpenVerbatim on those criteria before adopting code.
5. **Test financial failure and plan for vendor and recruiting lead time.** Exercise reordered events, unknown vendor outcomes and atomic payout reservations. Include AI and acquisition costs when tracking pilot margin. Retain the decided $1 unit price and track unresolved incentive, minimum and refund rules in the PRD. Reforecast dates after Gate 0 and surface any proposed scope cut to Rachel.

Track the revised evidence on [goal #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4) and in [STATUS](STATUS.md). The [build plan](BUILD_PLAN.md) contains the implementation instructions.
