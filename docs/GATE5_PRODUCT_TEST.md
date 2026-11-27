# December 5 fictional marketplace walkthrough

Status: fictional marketplace browser passed locally on `b575ca6` for ten reviewed completions and five verified referrals; its qualified report belongs to a separate seeded study in the same signed-in session. Draft PR #253's `32ed047` CI, Database and Local Auth checks passed; `b575ca6` has not yet been pushed or hosted-checked. The full same-study and protected-preview walkthrough remains open. No actual provider receipt exists. The coordinator records the final source and applied migration order before a walkthrough.

## Isolation and evidence record

Use a new protected preview with its own disposable database and private Storage. Never reuse Gate 1's standalone cleanup preview database. Record the preview deployment SHA, database identifier, actual `schema_migrations` history, Gate 2 migration 151 presence, and rollback deployment. Use fictional names, addresses, answers and profiles only. Keep external model dispatch and production money settings off.

**TEST Visa isolation preflight, currently unrun.** Before setting `ENVOI_GATE5_VISA_TEST_ENABLED=true`, the preview owner must record the actual Supabase project ref and Storage bucket in the preview dashboard, compare the project ref and host against the actual production project, confirm the preview uses separate private Storage and only fictional recipients, and record the reviewer, time and preview deployment SHA below. Configure `ENVOI_GATE5_ISOLATED_DATABASE_URL`, `ENVOI_GATE5_PRODUCTION_DATABASE_URL`, and their two project refs from those observed dashboards. Set `ENVOI_GATE5_ISOLATION_APPROVED=true` only after that receipt exists. The route rejects an absent approval, mismatched refs/hosts, non-Supabase or non-HTTPS URL, identical preview/production project, non-preview deployment, non-TEST key or missing secret. Matching operator-supplied values alone are not proof of isolation; the dashboard comparison is mandatory. Leave the route disabled and payout mocked if any field is unverified.

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
| 3. Checkout and launch | Pass | `b575ca6` used a deterministic paid observation and the signed-in tracking page visibly said **Payment simulated**. No Stripe TEST receipt exists; this is the explicitly simulated option. |
| 4. Ten approved completes after removal/replacement | Pass | `b575ca6` browser submitted five typed answers per respondent, reviewed one removal/replacement and reached ten approved completes plus one removed without changing the frozen $100 quote. |
| 5. Earnings and referral | Pass | `b575ca6` browser showed three mocked $15 receipts, then registered five distinct fictional profiles through the signed-in referral route; one $5 vesting row and **5 verified profiles** / **$5 referral bonus vested** appeared without claiming bonus delivery. |
| 6. Visa payout | Pass | `b575ca6` used an injected provider mock and the Earnings page visibly said **Payout mocked** above the synthetic Delivered $15 receipt. No TEST catalog, recipient or order receipt exists; this is the explicitly mocked option. |
| 7. Current-qualified report and export | Unrun | `3b79f75` report browser and Gate 3's local `074320a` mounted checks passed withdrawal, re-redaction, deletion and newer-withheld, with mobile WebKit withdrawal. `b575ca6` opened/exported that qualified report in the same signed-in researcher session, but it was a **different preseeded study** from the ten-complete marketplace study. Same-study qualified publication and withheld export remain to prove. |
| 8. Mobile interview trace | Unrun | No integrated mobile interview JavaScript/LCP trace or Gate 4 20-run measurement. |

## Required handoffs

- Gate 2: exact integrated #251 qualified-read contract and migration receipt; migration 151 database-backed quality reversal checks; TEST Visa SKU/recipient/denomination binding and payout receipt if provider validation becomes available.
- Gate 3: reviewed panel/controller mount, qualified fictional report fixture and revoked view/export check. No respondent text goes to an external model without approved purpose and Gate 1 qualification.
- Gate 4: mobile LCP and browser JavaScript measurements on the same integrated SHA.
- Coordinator: branch/PR order, protected preview/database isolation, exact test result and acceptance label. This checklist does not accept Gates 1–4 or authorize live enrollment.
