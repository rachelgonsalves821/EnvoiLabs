# Stripe disputes

**Scope:** a charge dispute or reversal on a researcher study. The Stripe Checkout, webhook, refund, and dispute handling paths are planned for Gate 2 and are not present in this checkout. This procedure needs an integration review before live use.

## Intake and containment

1. Confirm the Stripe account and environment, event ID, charge or payment ID, study ID, amount, currency, deadline, and current study state. Restrict cardholder and payment details to Stripe and approved internal records.
2. Acknowledge the event through the normal idempotent webhook path. Repeated or out-of-order events must converge on one dispute record and one financial effect.
3. Flag the study for Platform review. Do not reverse respondent rewards, delete completed research, issue a refund, or relaunch a study solely from an unverified event.

## Investigate and respond

1. Retrieve the charge and dispute directly from Stripe and compare them with the immutable quote, pricing version, checkout session, payment record, terms acceptance, study launch, and any prior refund. Check that amount and currency agree.
2. Assign an owner to the Stripe response deadline. Prepare evidence from approved records only: the study order, delivered service, terms, receipts, and relevant researcher communication. Exclude respondent PII, raw transcripts, audio, and unredacted findings.
3. Submit the response through the approved Stripe process. Record the evidence reference, decision, and timestamps in the restricted incident record.
4. Reconcile the final outcome with accounting and the study ledger. Any refund or balance adjustment must use the normal service and preserve one logical effect under webhook replay.

## Close

Verify payment and dispute status match Stripe, the researcher sees the correct study state, respondent compensation obligations were reviewed separately, and no private respondent data entered the dispute packet.
