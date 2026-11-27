# December 5 fictional marketplace walkthrough

Status: integrated local commit `cf54e4a` passed the full fictional Chromium journey on 96 migrations, including same-study source UUID, Unicode quote span, V2 count/total, private-field absence, consent revocation and no stale-client second CSV. Earlier `4bb2a5f` separately passed the normal held-200/fresh-409 consent path; Gate 3's local-only `source-unqualified` case passed on `698e0fa`. Draft #253's prior `c46c2d7` and coordinator draft #260 `9f9fe52` each have successful hosted CI, Database and Local Auth checks; the newer local commits are not hosted-checked. The protected-preview walkthrough remains open. No actual provider receipt exists.

## Isolation and evidence record

Use a new protected preview with its own disposable database and private Storage. Never reuse Gate 1's standalone cleanup preview database. Record the preview deployment SHA, database identifier, actual `schema_migrations` history, Gate 2 migration 151 presence, and rollback deployment. Use fictional names, addresses, answers and profiles only. Keep external model dispatch and production money settings off.

**TEST Visa isolation preflight, currently unrun.** Before setting `ENVOI_GATE5_VISA_TEST_ENABLED=true`, the preview owner must record the actual Supabase project ref and Storage bucket in the preview dashboard, compare the project ref and host against the actual production project, confirm the preview uses separate private Storage and only fictional recipients, and record the reviewer, time and preview deployment SHA below. Configure `ENVOI_GATE5_ISOLATED_DATABASE_URL`, `ENVOI_GATE5_PRODUCTION_DATABASE_URL`, and their two project refs from those observed dashboards. Set `ENVOI_GATE5_ISOLATION_APPROVED=true` only after that receipt exists. The route rejects an absent approval, mismatched refs/hosts, non-Supabase or non-HTTPS URL, identical preview/production project, non-preview deployment, non-TEST key or missing secret. Matching operator-supplied values alone are not proof of isolation; the dashboard comparison is mandatory. Leave the route disabled and payout mocked if any field is unverified.

Preview money display is also fail-closed: when the fictional walkthrough flag or preview isolation approval is off, the signed-in study page is unavailable and Earnings withholds all amounts and receipts without querying the ledger. This prevents a persisted synthetic Delivered row from losing its mock label when a preview flag is disabled. The source-level preview-off test passed locally; an actual protected-preview browser negative check remains unrun.

| Preview isolation receipt | Observed value |
| --- | --- |
| Preview deployment SHA and URL | Unrun |
| Preview Supabase project ref and host | Unrun |
| Production Supabase project ref and host | Unrun |
| Separate private Storage bucket and fictional recipient check | Unrun |
| Reviewer and observed time | Unrun |

For each row below, record **pass**, **fail**, or **unrun**, the exact browser/API receipt and source revision. `Unrun` never counts as pass. The overall walkthrough passes only if every required fictional step passes. A payout or payment can be labelled simulated where specified; the label must be visible to Rachel.

| Step | Fictional action | Required observation |
| --- | --- | --- |
| 1 | Sign up ten distinct fictional respondents; complete verified profiles and sign in a fictional researcher with TOTP. | Open profiles are eligible; researcher has AAL2 and organization membership. A second organization cannot read the study. |
| 2 | Create a five-core-question study and freeze a ten-complete quote. | Quote is 10 × 5 × $2 = $100. Each fully approved five-answer respondent can earn $5. Screener/probes do not change either amount. |
| 3 | Start Checkout. | Use actual Stripe TEST checkout only when TEST credentials and provider observation are recorded. Otherwise use the injected synthetic paid-launch fixture and show **Payment simulated**. One paid observation launches at most once. |
| 4 | Accept an offer, answer five core questions, complete a reviewed quality decision, remove one reviewed session and issue one replacement. | The private response reaches quality hold; removal cannot become approved by a direct state edit; replacement stays within ten purchased slots; ten approved completes are reached without duplicate replacement. |
| 5 | Read respondent Earnings and referral progress. | Earned, reserved, ordered and delivered are distinct. Five distinct verified referred profiles vest $5, but vesting alone is never described as delivered. Cross-account Earnings is denied. |
| 6 | Show the payout state. | **Payout mocked** until a TEST-only route, `TEST_` key, exact isolated database binding, account catalog Visa SKU, verified recipient, valid denomination, created order and verified receipt all exist. If all are present, record provider order ID and status; do not infer delivery from an initiation response. |
| 7 | Open the signed-in researcher report and request CSV export. | Route is AAL2, tenant-scoped, private/no-store and reads only the latest qualified report in a single current authorization snapshot. Use fictional qualified source. Withhold on lost consent, redaction qualification, current source or report version; export rechecks independently. An absent report is clearly unavailable. |
| 8 | Inspect the interview on a throttled mobile browser. | Record navigation, browser-requested JavaScript and LCP on the integrated SHA, and send the trace to Gate 4. An LCP miss is a launch hardening finding, not a false pass or an automatic blocker for this fictional walkthrough. |

### Local acceptance ledger, 2026-11-26

These are local fictional checks. The protected preview walkthrough has not run. `Pass` below applies only to the named local step, not the whole checklist.

| Step | Status | Receipt and remaining work |
| --- | --- | --- |
| 1. Open verified profiles and researcher access | Unrun | `65334da` browser created ten distinct fictional eligible profiles through a service fixture and signed in an AAL2 researcher. Ten open-signup UI journeys were not exercised. |
| 2. Frozen quote | Pass | `65334da` browser asserted five core questions, ten matched respondents and one frozen $100 quote at $2/$1. |
| 3. Checkout and launch | Pass | `4bb2a5f` used a deterministic paid observation and showed **Payment simulated · No card charged** inside the signed-in tracking heading after a 320px reload. No Stripe TEST receipt exists. |
| 4. Ten approved completes after removal/replacement | Pass | `4bb2a5f` full-mode browser submitted five typed answers per respondent, reviewed one removal/replacement and reached ten approved completes plus one removed without changing the frozen $100 quote. Its separate normal run observed held HTTP 200 and fresh post-withdrawal HTTP 409 after consent withdrawal, with no question or answer field remaining. |
| 5. Earnings and referral | Pass | `4bb2a5f` full-mode browser showed three synthetic $15 receipts, then registered five distinct fictional profiles through the signed-in referral route; one $5 vesting row and **5 verified profiles** / **$5 referral bonus vested** appeared, without Delivered, Receipt or Visa-sent wording in the referral card. |
| 6. Visa payout | Pass | `4bb2a5f` used an injected provider mock. **Payout mocked · No Visa sent** stayed within the nonzero Delivered card, and each synthetic receipt carried its own mock label after a 320px reload. No TEST catalog, recipient or order receipt exists; this is the explicitly mocked option. |
| 7. Current-qualified report and export | Pass | `cf54e4a` full-mode browser qualified one Unicode typed answer from the newly fielded ten-complete study using a disposable Gate 1 job, then Gate 3's reviewed publisher accepted one low-confidence fictional theme (count 1 of 10). Its AAL2 current read returned the same study/report ID with `private, no-store`; the public JSON quote's transcript UUID, source version and code-point span 29–42 matched the persisted redacted transcript, while private review fields were absent from JSON and CSV. The mounted panel and CSV contained the exact quote. Withdrawing source researcher-access consent made a fresh GET private/no-store 404; clicking the still-mounted Download button issued no second CSV and withheld the panel. The separate Gate 3 local-only `source-unqualified` case on `698e0fa` checked invented private sentinels absent from public JSON/panel/CSV and withheld the report after a synthetic private-status change. This is synthetic one-source publication and status invalidation, not AI synthesis over ten answers, an adversarial PII test or a real redaction pipeline pass. |
| 8. Mobile interview trace | Partial | One disposable 360px Chromium diagnostic on `92eacef`/build `wiVnXRg6NFpcoO1rdeNUh` passed with 4× CPU, 150ms latency and 1.6Mbps down: LCP 1,844ms, first usable question 2,032ms and ten requested JS resources transferring 197,565 bytes. The non-sensitive resource receipt is `docs/evidence/gate5-mobile-diagnostic-92eacef.json`. This source lacks Gate 2's final WebGL Echo and Gate 4's lazy import patch; one run cannot establish p75 under 2.5s or the final 200KB JS budget. Gate 4 still needs 20 cold runs each for voice and typed mode on the final integrated build. |

## Required handoffs

- Gate 2: exact integrated #251 qualified-read contract and migration receipt; migration 151 database-backed quality reversal checks; TEST Visa SKU/recipient/denomination binding and payout receipt if provider validation becomes available.
- Gate 3: reviewed panel/controller mount, qualified fictional report fixture and revoked view/export check. No respondent text goes to an external model without approved purpose and Gate 1 qualification.
- Gate 4: mobile LCP and browser JavaScript measurements on the same integrated SHA.
- Coordinator: branch/PR order, protected preview/database isolation, exact test result and acceptance label. This checklist does not accept Gates 1–4 or authorize live enrollment.
