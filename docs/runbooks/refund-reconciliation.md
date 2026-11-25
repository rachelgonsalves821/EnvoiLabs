# Partial refund reconciliation

**Scope:** a frozen-price unfilled-slot refund whose Stripe outcome is pending, failed, or unknown. Gate 2's current route is disabled by default and accepts only a test-mode Stripe key. This is a rehearsal runbook; no production refund or manual provider action is authorized by it.

## Contain

1. Identify the study, frozen quote version and line item, paid checkout, immutable refund reservation, provider idempotency key, and any stored refund ID from restricted records. Compare purchased slots with distinct approved or paid fulfilled slots at the reservation cutoff. For a five-question 12-slot quote with 11 fulfilled slots, the frozen refund is one 1,000-cent slot.
2. If a provider create request timed out, treat its outcome as unknown. Keep the reservation and original key. Do not issue another refund from a dashboard or with a new key. The current database allows at most three leased create attempts within 23 hours; after that window it returns unavailable rather than assuming the first request failed.
3. Keep pending and action-required provider refunds separate from settled refunds. Do not tell a researcher that a refund completed based on the browser return marker, a pending event, or a stale route response.

## Reconcile

1. Read the current Stripe test-mode Checkout, PaymentIntent, and refund by stored identity or the original idempotency key through the owned adapter. Verify test mode, quote and study metadata, original payment amount and currency, exact reserved refund amount, and provider refund ID. A mismatched or incomplete provider list is an incident, not evidence that no refund exists.
2. If the original provider request may have succeeded without a response, use the same key and the provider's current refund list before any bounded retry. After the key-retention window or if the provider cannot establish the outcome, leave the case unavailable for human/provider investigation. Never create a fresh key to make progress.
3. Persist a current pending, succeeded, or failed observation through the service-only RPC. Before showing a researcher a status, read the latest authoritative refund receipt: the draft RPC accepts an exact replay of an earlier pending event even after a succeeded event exists. The event ledger stays terminal, but a route that simply returns the replayed provider observation could display an older state.
4. For a definitive failed refund, retain the researcher's claim and investigate a controlled replacement policy. A failed provider event alone does not justify silently reserving a second amount or changing the frozen quote.

## Close and rehearsal gate

Use fictional IDs and a fake Stripe provider to race two reservation/claim callers, lose the first create response after provider acceptance, replay an earlier pending event after success, and deliver duplicate or out-of-order settlement events. Require one reservation, one provider refund identity, the original key, no late fulfilled-slot mutation, and a current receipt that never regresses from succeeded to pending. Inspect logs for cardholder details, respondent data, provider payloads and bearer URLs. Assign an operator and test the current receipt reader before enabling the route in any real payment environment.
