# December 5 fictional marketplace walkthrough

Status: preparation. Source base `410b141`; Gate 5 draft PR #253 at `5d4ce17`. No integrated preview, provider receipt or qualified report has passed this checklist. The coordinator records the final source and applied migration order before a run.

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

## Required handoffs

- Gate 2: exact integrated #251 qualified-read contract and migration receipt; migration 151 database-backed quality reversal checks; TEST Visa SKU/recipient/denomination binding and payout receipt if provider validation becomes available.
- Gate 3: reviewed panel/controller mount, qualified fictional report fixture and revoked view/export check. No respondent text goes to an external model without approved purpose and Gate 1 qualification.
- Gate 4: mobile LCP and browser JavaScript measurements on the same integrated SHA.
- Coordinator: branch/PR order, protected preview/database isolation, exact test result and acceptance label. This checklist does not accept Gates 1–4 or authorize live enrollment.
