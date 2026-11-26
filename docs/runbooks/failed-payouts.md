# Failed payouts

**Scope:** a gift card payout after quality approval. Gate 2 has not supplied the final payout service or admin controls in this checkout. Validate every control and command against that implementation before production use. Do not issue a manual gift card from a dashboard to work around an unknown order outcome.

## Detect and contain

1. Confirm the environment and affected payout IDs from the payout dashboard or restricted ledger. Separate `pending`, provider-rejected, and outcome-unknown orders. Do not copy recipient email, gift card URL, or provider payload into an incident ticket.
2. Pause automatic retry for an affected payout if the provider may have accepted the order but the response or webhook was lost. Keep its ledger entry `pending`; do not mark it paid or create a new key.
3. Check quality approval, current consent and deletion state, annual cap reservation, amount, currency, reward choice, and the original idempotency key before any recovery action. For a marketplace study, compare the amount with distinct recorded, answered **core** questions at the frozen $1-per-question reward; probes, blank answers and repeat recordings of one core question must not increase the payout. Gate 2 draft #165 now enforces this at the database reservation boundary, with a local two-client annual-cap rehearsal; the final provider and Earnings integration is still absent. Do not treat a full offer reward as the earned amount.

## Reconcile and recover

1. Query Tremendous for the original order using its provider ID or idempotency key. Compare recipient, amount, currency, and status with the immutable payout record. A timeout alone does not establish failure.
2. If the provider confirms delivery, attach its order reference to the same payout and advance status once. Confirm the respondent can see the status in Earnings without exposing the gift card to another account. Gate 2 draft #166 supplies a default-off, private current Earnings read; it does not yet mount the mobile UI or deliver a card.
3. If the provider confirms no order exists or a definitive rejection, fix the underlying cause, then retry the same logical payout through the service. Verify that the idempotency key and annual cap reservation remain stable. Escalate permanent rejection to a human review queue.
4. If the provider cannot establish the outcome, leave `pending`, stop automated duplicate attempts, and escalate to Platform and provider support. Tell the respondent only that payment is delayed, without promising a date that has not been confirmed.

## Close

Verify exactly one provider order per approved payout, no cap breach, the approved answered-core amount, matching ledger and provider status, respondent visibility, and an audit trail of every attempt. Keep a vested $5 referral bonus separate from a delivered payout in both the ledger and Earnings. Record affected count and time to resolution. Do not re-enable retries until the unknown-outcome path is tested.
