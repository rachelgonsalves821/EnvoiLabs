# Launch runbooks

These are operator procedures, not proof of launch readiness. Record the environment, incident time, affected IDs, owner, actions, and recovery evidence in the incident record. Use only IDs and aggregate counts in tickets or chat; keep raw answers, audio, contact details, tokens, and provider payloads in their restricted systems.

Before using a runbook, confirm the environment and the current deployed revision. Gate 1 currently has only the private answer and expiry jobs. The money and probing procedures below include checks for Gate 2 and Gate 3 capabilities that must be reconciled with their final implementation before launch.

| Incident | Runbook |
| --- | --- |
| Gift card order failed, delayed, or outcome unknown | [Failed payouts](failed-payouts.md) |
| Scheduled or queued work stops progressing | [Stuck jobs](stuck-jobs.md) |
| LLM provider outage or excessive timeouts | [LLM outage](llm-outage.md) |
| Stripe charge dispute or reversal | [Stripe disputes](stripe-disputes.md) |

Gate 4 audit records: [security review and rate-limit paths](security-review.md) · [limiter proposal](rate-limit-proposal.md) and [exact integration handoff](rate-limit-integration.md) · [integration chaos fixtures](integration-chaos-fixtures.md) · [performance measurement plan](performance-measurement.md) · [readiness evidence](launch-readiness.md).
