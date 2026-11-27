# Status and handoffs

Append-only. Newest entries at the bottom. Use the template in `docs/BUILD_PLAN.md` section 9.

## Gate checklist tracker

| Gate | Target | State | Evidence |
| --- | --- | --- | --- |
| Gate 0 Foundations | End of week 1 | Passed. Delegated sign-off recorded | [Build and browsers](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44952555314), [database](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44952555269), [local auth](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44952555268), [both hosted sign-ins on the same deployment](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7071655542) |
| Gate 1 Vertical slice | End of week 3 | Open. The hosted seeded study, scheduling and live speech passed. The protected preview passed the synthetic scheduled audio cleanup rehearsal. The latest independent redaction result is below threshold, and signed-in researcher publication is pending. | [Browser study and private worker](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/45030028488), [live speech](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/45280585136), [latest qualification result](https://github.com/rachelgonsalves821/EnvoiLabs/pull/112), [integration evidence](#2026-11-24-gate-1-integration-evidence), [hosted cleanup](#2026-11-26-gate-1-hosted-scheduled-audio-cleanup) |
| Gate 2 Money loop and scoping | End of week 5 | Not started | |
| Gate 3 Probing, reports, pilot | End of week 7 | Not started | |
| Gate 4 Launch hardening | End of week 8 | Not started | |

## Entries

## 2026-11-19, Rachel (via Claude)
Done: PRD, build plan and agent briefs written
Next: Agent 1 starts Gate 0. Agents 2 and 3 start their week 1 items against fakes
Needs from others: none
Contract or schema changes: none yet
Risks: pricing (PRD Q-01) and counsel checks (Q-04 to Q-06) are open

## 2026-11-19 19:03, Agent 1 (Platform)
Done: Kickoff scaffold with pnpm, Turborepo, Next.js, PR CI and draft shared contracts for R-RSCH-02, R-RSCH-03, R-RSCH-08, R-RESP-04, R-RESP-06 and R-RESP-08. The contract build, typecheck and 17 contract tests passed locally.
Next: Verify all scaffold checks in GitHub CI, commit the generated lockfile, then finish Gate 0 schema, auth, contracts and fakes.
Needs from others: Respondent and Researcher can use the draft contracts after the scaffold merges.
Contract or schema changes: Draft Brief, BriefPatch, GuideDraft, ScopingTurn, ProbeDecision, QualitySignals, ThemeSet, InvitePreview and InterviewProgress with parsing tests. The full v1 contracts are still in progress.
Risks: The local environment could not reach the package registry to complete the monorepo install. The first GitHub CI run can generate the lockfile.

## 2026-11-19 21:34, Agent 3 (Researcher and AI)

Done: R-RSCH-01 sign-in and authenticator setup screens and browser specs. R-RSCH-02 to R-RSCH-04 offline baseline evals replay six fixtures across five suites.
Next: Integrate the researcher auth service and browser harness, then verify both locally and in preview.
Needs from others: Agent 1 authenticated workspace guard and routes for email start, confirmation and MFA.
Contract or schema changes: Agreed researcher auth request and response shapes. No shared schema edits.
Risks: Offline dependency cache could not install Next.js. Auth browser specs need the shared Playwright harness. Full eval fixture counts and live model and judge runs remain open.

## 2026-11-19 21:16, Agent 1 (Platform)
Done: R-RESP-01 and R-RSCH-01 identity migration with tenant, self-only and MFA access boundaries. Added the first IT-0.2 pgTAP checks and a fresh-migration CI job.
Next: Wire server-side signup and enrollment, expand the schema and access matrix, and add the Gate 0 seed.
Needs from others: RachelΓÇÖs privacy review before merge.
Contract or schema changes: Added organizations, researcher membership, respondent identity and a server-only private phone table.
Risks: The local Docker daemon was unavailable. The migration and pgTAP tests need their first GitHub CI run before this slice can merge.

## 2026-11-19, Gate 0 handoff

Done: The [Platform scaffold](https://github.com/rachelgonsalves821/EnvoiLabs/pull/1) merged with passing CI. The [researcher and AI slice](https://github.com/rachelgonsalves821/EnvoiLabs/pull/2) and [respondent and shared UI slice](https://github.com/rachelgonsalves821/EnvoiLabs/pull/3) are in draft review.
Next: Platform database, access policies, auth and fakes. Connect the respondent and researcher shells to auth and the researcher shell to the shared UI. Extend the provider and eval coverage.
Needs from others: Platform auth and final Gate 0 contracts.
Contract or schema changes: No changes in the two shell PRs.
Risks: Browser and database integration evidence is still due for Gate 0 sign-off.

## 2026-11-19 21:56, Agent 3 (Researcher and AI)

Done: R-RSCH-02 and R-PLAT-07 provider foundations. Added Anthropic, OpenAI, and Groq adapters with mocked HTTP tests. The AI package typecheck and build, nine mocked transport checks, and all six replay fixtures passed locally.
Next: Verify the package test runner in CI and wire the adapters into consent-checked server jobs in the appropriate gate.
Needs from others: Platform must provide the reviewed vendor configuration and usage rates before enabling any live calls.
Contract or schema changes: Provider interfaces are unchanged. Adapter factories and failure types are exported.
Risks: OpenAI announced that the PRD-selected transcription model shuts down February 26, 2027. Choose and evaluate a replacement before enabling it past the cutoff. The Vitest run is pending CI because the local frozen install requires an uncached Playwright package.

## Gate 0 local acceptance evidence

Done: The production build, typecheck, lint, unit tests and desktop Chromium/mobile WebKit checks passed. The browser suite passed 20 tests. The two opt-in local Auth cases passed separately against a fresh Supabase stack, covering respondent phone OTP and researcher email link plus TOTP. Database migrations, seed replay, access policies, public type drift, contracts, generated design tokens and provider fakes are verified in CI.
Next: Configure the hosted preview, apply migrations in its Supabase project and verify both auth flows there. Record delegated sign-off after that evidence is available.
Needs from others: Access to the Vercel preview project and a disposable Supabase preview project.
Contract or schema changes: Gate 0 identity, survey schema, Auth provisioning, public database types and Gate 1 data contracts are merged.
Risks: Hosted configuration and provider delivery remain unverified. The local test used synthetic accounts and sent no real messages.

Evidence: [auth integration PR](https://github.com/rachelgonsalves821/EnvoiLabs/pull/14), [browser CI](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44665100411), [positive local Auth CI](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44665100493), [database and type drift CI](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44665291413).

## Gate 0, Agent 1, R-PLAT-01 integer cents

Done: Added lint coverage for fractional money constants in production application and package code. The regression suite exercises the repository ESLint configuration against valid and invalid cents fields. See `tools/eslint/integer-cents.test.mjs`.
Next: Verify the PR checks and run both sign-in journeys on the hosted preview before Gate 0 sign-off.
Needs from others: Access to the dedicated Vercel and Supabase preview projects.
Contract or schema changes: None.
Risks: Runtime inputs still require integer validation at their service and schema boundaries.

## 2026-11-20, Gate 0 integration handoff

- Respondents can retry a stalled signup request, and verification requires explicit server confirmation. Keyboard users retain focus during a pending request and after a recoverable failure. The browser tests cover reduced motion, 44 px hit targets and 360, 390 and 430 px viewports. [Signup recovery](https://github.com/rachelgonsalves821/EnvoiLabs/pull/18) · [Accessibility checks](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44678457421)
- Researchers can request a new sign-in link after an expired MFA session. A temporary identity provider outage returns a retryable service error. [MFA recovery](https://github.com/rachelgonsalves821/EnvoiLabs/pull/19) · [Auth service checks](https://github.com/rachelgonsalves821/EnvoiLabs/pull/22)
- The local researcher journey now submits the sign-in form and opens the actual email captured by Mailpit before completing TOTP. The disposable Supabase suite also verifies respondent phone signup. [Delivered email change](https://github.com/rachelgonsalves821/EnvoiLabs/pull/20) · [Passing auth run](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44677957293)
- The money lint rule catches fractional and unsafe numeric constants in cents fields. Runtime validation still belongs at service boundaries. [Rule and regression tests](https://github.com/rachelgonsalves821/EnvoiLabs/pull/21)
- Gate 0 remains open. The remaining hosted acceptance evidence must show both respondent phone verification and researcher email plus TOTP using the dedicated Vercel and Supabase preview projects. No hosted sign-off was recorded in this handoff.

## 2026-11-20, Platform, R-RSCH-01 and R-RESP-01

Done: Added a Gate 0 lint check and regression cases for relative imports across respondent and researcher API folders. Researcher request timeout and confirmation coverage merged in #24.
Next: Run both sign-in journeys on the dedicated hosted preview and record redacted evidence against the deployed commit.
Needs from others: Dedicated Vercel and Supabase preview access, a test phone and mailbox, and a provisioned researcher with accepted terms.
Contract or schema changes: None.
Risks: Local delivery tests do not exercise the hosted sender or SMS configuration.

## 2026-11-20, Gate 0 integration, R-RESP-01

Done: Extended the disposable Supabase phone journey in `apps/web/e2e/auth-local.spec.ts` to submit an incorrect six-digit code, check the browser session and respondent count, and retry from the same form with the correct code. The successful path checks the server-side age attestation.
Next: Verify real SMS delivery and researcher email plus TOTP on the dedicated preview deployment.
Needs from others: Access to the dedicated Vercel and Supabase projects and their test identities.
Contract or schema changes: None.
Risks: The local OTP fixture cannot establish hosted SMS delivery.

## 2026-11-20, Platform, hosted R-RESP-01 and R-RSCH-01 acceptance

Done: Added the [hosted sign-in procedure](../README.md#verify-sign-in-on-the-hosted-preview) and evidence fields. Main at eabafad passed [build and browsers](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44693133860), [database and seed](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44693133832), and [both local sign-in journeys](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44693133845).
Next: Platform records both hosted outcomes against the tested deployment. Gate 0 remains open.
Needs from others: Access to the dedicated preview projects, a controlled SMS number and mailbox, and a provisioned test researcher with accepted terms.
Contract or schema changes: None.
Risks: Hosted SMS and email delivery and MFA configuration are still unverified.

## 2026-11-20, Platform, R-RSCH-01 membership lookup recovery

Done: Researcher MFA returns a retryable 503 when membership lookup is unavailable and a 403 for a confirmed nonmember. Handler tests cover a failed lookup followed by successful enrollment and a consumed email link with unconfirmed membership. The callback requires a fresh link and withholds the pending session in that case.
Next: Verify hosted sign-in against the dedicated preview projects.
Needs from others: Preview access and controlled test identities.
Contract or schema changes: None.
Risks: Real SMS and email delivery remain unverified.

## 2026-11-20, Platform, Gate 0 design token drift

Done: CI now compares the UI token JSON with the design-system export before the existing generated-CSS check. The comparison ignores JSON formatting and checks both themes. This covers the shared UI foundation used by R-RESP-01 and R-RSCH-01.
Next: Verify both sign-in journeys on the dedicated preview.
Needs from others: Hosted preview access and test identities.
Contract or schema changes: None.
Risks: Hosted SMS and email delivery still need direct verification.

## 2026-11-20, Platform, Gate 0 shared contracts distribution

Done: Versioned the private contracts package at 1.0.0. CI packs its compiled exports, checks a consumer import and declaration entry point, and uploads the tarball on successful main builds. R-RSCH-01 and R-RESP-01 share the same package. The existing IT-0.3 suite verifies contract fixtures.
Next: Verify the first main artifact and record it on goal #4. Hosted sign-in remains open.
Needs from others: Dedicated Vercel and Supabase access and controlled test identities.
Contract or schema changes: Package metadata and distribution only.
Risks: CI artifacts follow the repository's retention policy.

## 2026-11-20, Platform, build plan audit

Done: Compared the build kit and standalone plan with the merged foundations. Updated gate criteria, pre-study checks, implementation boundaries and the three briefs. See the [audit](BUILD_PLAN_AUDIT.md).
Next: Verify both hosted sign-in paths and reconcile the remaining Gate 0 evidence. Prepare Gate 1 acceptance scenarios while preview access is pending.
Needs from others: Dedicated preview access and controlled test identities.
Contract or schema changes: None.
Risks: Hosted acceptance and live provider behavior remain unverified.

## 2026-11-20, Platform, revised kit and Gate 0 evidence

Done: Reviewed the revised build kit and incorporated the respondent and researcher journeys, design guidelines and upstream evaluations. The three main workflows passed at `1f988488`. Confirmed the [contracts artifact](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44837195089/artifacts/14679237453) is available for that commit.
Next: Close the four-question pre-freeze contract and IT-0.2 role coverage gaps. Match the dedicated hosted deployment to its commit and Supabase migration state. Record separate outcomes for real SMS delivery and attestation, email delivery, pre-MFA gating and post-MFA workspace access. The [Gate 1 handoff](GATE_1_HANDOFF.md) defines the initial work after sign-off.
Needs from others: Dedicated Vercel preview URL and access, a preview Supabase project and an operator or scoped access, a controlled test phone, and a provisioned researcher with a controlled mailbox, organization membership and accepted terms.
Contract or schema changes: None.
Risks: The GitHub workflows verify local behavior. Both hosted journeys remain unverified.

## 2026-11-21, Platform, Gate 0 hosted acceptance status

Done: Verified the dedicated preview is Ready at app commit `fc19ba5`. The only file changed through `50cba3e` is the database test matrix. All five migrations are in the preview migration history. Main passed build and browser, database and local auth checks. The [four-question contracts package](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44840035438/artifacts/14680676355) is available. The database suite covers all 33 application tables across seven access contexts.

Next: For R-RESP-01, configure live Twilio Verify, test with an adult-controlled number, verify code delivery and confirm the age-attestation record. For R-RSCH-01, configure SMTP, install the checked-in magic-link template and use the provisioned internal researcher account. Verify link delivery, workspace access denied before TOTP and workspace access after TOTP. Record both results on [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4) before sign-off.

Needs from others: Twilio Verify and SMTP sender setup, plus an adult-controlled SMS test number. The internal researcher account is provisioned with confirmed draft v0.1 acceptance.

Contract or schema changes: None.

Risks: The preview database confirms internal researcher membership and recorded acceptance. The live sign-in checks remain open. Gate 1 has a [handoff](GATE_1_HANDOFF.md) ready for sign-off.

## 2026-11-21, Platform, R-RESP-01 and R-RSCH-01 hosted preview

Done. The dedicated preview is Ready at `7b62dcd` (Vercel deployment `dpl_5HQUNHouP23ELJRYExFCKJ8UNUHz`). A live hosted HTTP check for the provisioned internal researcher passed. A sign-in email from the built-in Supabase sender reached the test inbox. The delivered link completed the proof-key callback. The workspace was locked before TOTP and rendered after verification. The check revoked its temporary TOTP factor and preview access. PR [#38](https://github.com/rachelgonsalves821/EnvoiLabs/pull/38) supports that sender's standard proof-key callback and adds disposable browser coverage for both email templates through TOTP. The preview has the provisioned internal researcher and recorded terms acceptance.

Next. Verify respondent SMS delivery, sign in with the code and confirm the persisted adult attestation. Record the outcome on [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4) before signing off.

Needs from others. Access to an activated Twilio account and an adult-controlled test phone that can receive its verification SMS. The built-in sender covers the internal researcher mailbox.

Contract or schema changes. None.

Risks. The preview's phone provider is disabled until a live SMS service is connected. Gate 1 acceptance scenarios, synthetic recordings and the first redaction benchmark are prepared. Feature work follows hosted Gate 0 sign-off.

## 2026-11-21, Platform, R-RESP-01, R-RESP-04 and R-RESP-10 respondent account

Done. Clarified the persistent account in the PRD and mapped it to the build plan and hosted procedure. Gate 0 verifies phone sign-in and account provisioning. Gate 1 delivers signed-in Home for eligible invites and in-progress studies and checks return sign-in. Gate 2 delivers gift card brand choice, status and history in Earnings.

Next. Verify the hosted respondent account with a real SMS and its saved age attestation, then start the Gate 1 implementation.

Needs from others. An activated SMS provider account and a controlled test phone for the current hosted sign-in method.

Contract or schema changes. None.

Risks. The live respondent check remains open. Researcher sign-in passed.

## 2026-11-21, Platform, R-RESP-01 respondent email sign-in

Done. Rachel approved passwordless email for the persistent respondent account. The PRD and build plan use an emailed link for sign-in, with the existing Home and Earnings journeys inside the app.

Next. Verify live respondent email delivery, account provisioning and age attestation on the hosted preview. Check researcher workspace access before and after TOTP on the tested deployment. Record results on [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4) before Gate 1 implementation.

Needs from others. None for the internal check. Use distinct test identities and the authorized team inbox for delivery. The first external study requires a dedicated email sender.

Contract or schema changes. Respondent email-link start replaces the phone code request and verification contracts. The service-only provision function requires a verified email and preserves the existing respondent ID and age attestation on return.

Risks. Supabase built-in email has team inbox and rate limits. Use a dedicated sender before recruiting external respondents.

## 2026-11-21, Platform, Gate 0 passed under Rachel’s delegation

Done. The merged email sign-in change [#41](https://github.com/rachelgonsalves821/EnvoiLabs/pull/41) passed [build, lint, types, unit and browser checks](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44952555314), [database checks](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44952555269) and [disposable email auth with both link formats](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44952555268). The build produced the v1 contracts package and ran IT-0.3. The database suite verified clean migrations, idempotent seed, generated types and the IT-0.2 access matrix. The signed-in respondent page stays private, the researcher workspace enforces TOTP, and both role tests use delivered links. Gate 0 debt items D-002 through D-004 are closed. D-001 remains scheduled for Gate 2.

Hosted R-RESP-01 passed on `6996f425` at [deployment dpl_B1vQ5ouSuxhaYM3MMaEVBiPEW5LR](https://vercel.com/rachelgonsalves821s-projects/envoilabs/B1vQ5ouSuxhaYM3MMaEVBiPEW5LR). The dedicated Supabase project `ndanhlqodsgfipwrulji` has all six migrations. In the 21:39 UTC check, a live email link opened the protected respondent account, age attestation persisted, and the respondent session was denied by the researcher MFA endpoint. The email sign-in merge and this preview have identical source trees.

Hosted R-RSCH-01 passed on `7b62dcd` at [deployment dpl_5HQUNHouP23ELJRYExFCKJ8UNUHz](https://vercel.com/rachelgonsalves821s-projects/envoilabs/5HQUNHouP23ELJRYExFCKJ8UNUHz). The live email completed the callback, the workspace stayed locked before TOTP and opened afterward. [Researcher evidence](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7069318710). Both researcher variants passed the disposable email and TOTP checks again on the respondent deployment's code. The supplemental live researcher retry on `6996f425` encountered an email quota and is queued for after the limit clears.

Next. Start the Gate 1 implementation in the order documented in the [handoff](GATE_1_HANDOFF.md). Record the supplemental researcher retry on [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4).

Needs from others. None for Gate 1 kickoff.

Contract or schema changes. The v1 contract artifact includes respondent email-link start. The new provisioning function verifies the Auth email and preserves the respondent identity and original age confirmation on return.

Risks. The hosted internal check uses Supabase's team-only sender. A dedicated email sender is required before external participant enrollment. The payment and incentive decisions remain scheduled for Gate 2.

## 2026-11-21, Platform, Gate 1 R-PLAT-03

Done. Started Gate 1 after delegated Gate 0 sign-off. Added pure study, invite, session and payout transition functions with audit fields. Test launch requires explicit preview authorization. Invite acceptance and active sessions enforce their deadlines using an injected clock.

Next. Persist transitions and audit evidence atomically. Connect seeded matching, invite acceptance, session services and researcher tracking to the tested transitions.

Needs from others. None for this increment.

Contract or schema changes. None.

Risks. This increment defines transition rules. Database concurrency, expiry jobs and audited retries remain to be verified by IT-1.4 and IT-1.5.

## 2026-11-21, Researcher and AI, Gate 1 R-RSCH-08 and R-RSCH-09 upstream review

Done. Recorded the [OpenInterviewer design review](adr/0002-openinterviewer-review.md) using the pinned revision and verified license. Adopted the design patterns for clarification, save-before-analysis, grounded quote selection and follow-up study provenance.

Next. Apply the answer persistence and retry pattern in IT-1.5. Use the ADR's checks when implementing probes, reports and next-study proposals.

Needs from others. None.

Contract or schema changes. None.

Risks. Upstream behavior varies by mode. Envoi's limits, consent and publication rules are authoritative.

## 2026-11-21, Respondent, Gate 1 R-RESP-02 and R-RESP-03

Done. Added a signed-in mobile profile and four separate privacy choices. The profile saves typed structured answers. Preview consent records the text version for each purpose and retains a history of changes. The respondent can review saved choices after returning.

Next. Connect eligible studies on Home and enforce current consent in the recording, transcription, retention and researcher access paths. Add optional spoken profile answers after the consented voice path is available.

Needs from others. Platform matching and the consented voice intake path.

Contract or schema changes. Reused the existing profile and consent request contracts. The migration adds two authenticated procedures that derive respondent identity from the session and serialize changes for the active account.

Risks. This is the synthetic preview flow. Production consent text and processing still need the pre-study checks. See the [database checks](../packages/db/tests/respondent_onboarding.sql) and [disposable mobile browser scenario](../apps/web/e2e/auth-local.spec.ts).

## 2026-11-21, Researcher and AI, Gate 1 study draft

Done. Added the researcher form for a four-question study draft, with two seeded criteria and a target for completed interviews. The server saves the study, brief version, criteria and ordered guide in one organization-scoped transaction, along with an audit entry and a study-created event. The form shows success only after the server confirms the draft. Added route authorization and validation tests, database rollback and retry checks, and delivered-email browser coverage that creates a study after TOTP.

Next. Connect the persisted draft to the test-only launch, matching and tracking services. Expand the browser test to IT-1.1 when the respondent study journey is ready.

Needs from others. Platform launch and tracking services for the next researcher slice.

Contract or schema changes. The frozen study draft body and response are reused. Creation also requires an idempotency key. The service-only database function verifies organization membership and persists the draft in one transaction.

Risks. The first form offers the supported criteria from the seeded panel. The real scoping chat is planned for Gate 2.

## 2026-11-21, Platform, Gate 1 R-PLAT-02

Done. Added the test-only study launch service. It matches an opted-in preview study against profile criteria, active invitations and participation limits. It creates the first invite batch and records the launch and invite transitions in one transaction.

Next. Connect the respondent Home and invite acceptance to the same seeded study.

Needs from others. None.

Contract or schema changes. Uses the frozen Gate 1 launch contract. The service-only launch function and the disposable seed supply the preview launch and incentive.

Risks. Future invite waves and the historical feasibility estimate remain open. Preview launch has an explicit opt-in and stays disabled in production.

## 2026-11-21, Respondent, Gate 1 R-RESP-04

Done. Added the signed-in Home list with owned active invitations, screening flags, accepted studies and in-progress status. The projection exposes just the invitation metadata needed for Home. The card shows reward, time, question count, reason and privacy details with a neutral participant label.

Next. Connect accept, decline, and resume to the Platform operations. Add an approved participant-facing topic when the researcher form collects one.

Needs from others. Platform invite actions and session routing.

Contract or schema changes. Added a narrow authenticated query without changing the existing invite mutation contracts.

Risks. Home is a read-only increment. The [database checks](../packages/db/tests/respondent_home_invites.sql) and [disposable browser scenario](../apps/web/e2e/auth-local.spec.ts) cover ownership and disclosure.

## 2026-11-21, Researcher and AI, Gate 1 R-RSCH-07 tracking

Done. The researcher can open tracking from a successful preview launch. The MFA-protected page reads the study title and target through existing tenant policies and refreshes invited, accepted, completed and removed counts while the page is visible. A caller from another organization sees no row.

Next. Add consent-scoped redacted transcript display and exercise IT-1.1 with the respondent journey.

Needs from others. The redacted transcript publication path.

Contract or schema changes. Reused the frozen tracking response. The read function checks organization scope and returns aggregates without granting researcher access to individual invite or session rows.

Risks. Tracking displays confirmed counts. Sample composition and a projected finish still need their own data sources.

## 2026-11-21, Respondent, Gate 1 R-RESP-04 and R-RESP-06

Done. Connected Start answering, Not for me and Continue interview to the scoped invitation and session operations. The interview shows the first unanswered question, progress and reward. The typed path validates saves before advancing, keeps the same answer ID for a retry with unchanged text, and shows a pending quality check after submission confirms.

Next. Verify against disposable Supabase. Add browser recording, private upload and transcription through the Gate 1 voice contract.

Needs from others. Platform invitation, answer and submit endpoints and the voice upload implementation.

Contract or schema changes. None. The UI uses frozen request and response schemas.

Risks. This increment exercises typed answers. The [disposable scenario](../apps/web/e2e/auth-local.spec.ts) covers consent denial, reload after two answers, four typed saves, quality hold and a different respondent’s invitation.

## 2026-11-22, Researcher and AI, Gate 1 R-RSCH-10 transcript viewer

Done. Study tracking fetches published redacted text through the current researcher's authenticated session. The database enforces organization and current consent, and the response returns only the transcript identifier and redacted text. The browser clears previously rendered text after a denial, a failed refresh or when the tab is hidden.

Next. Run IT-1.1 through answer publication and exercise the publication worker's pending, failed and consent-withdrawal cases.

Needs from others. The approved redaction and publication path for real provider results.

Contract or schema changes. Reuses the frozen transcript list shape and existing access policies. This increment only reads published rows.

Risks. The viewer currently lists published text. Respondent grouping, approved profile descriptors and exports remain open.

## 2026-11-22, Respondent, Gate 1 R-RESP-07

Done. Added a browser recorder that checks consent before offering the microphone. Stopping stages the recording through a signed write URL while local playback is available. Save confirms the staged answer and advances after acknowledgement. Respondents can re-record, retry a failed upload with the same take, or switch to typing.

Next. Run the signed-in disposable browser check against actual private Storage and confirmation. Verify a private, short-lived on-device draft after a crash.

Needs from others. Platform audio reservation and confirmation, and the speech-to-text job.

Contract or schema changes. None. Reused the frozen upload and record-answer schemas.

Risks. Unconfirmed audio survives retry in the current page. Closing the page discards the in-memory recording. Browser-local drafts need verified-account scoping, consent-revocation cleanup and expiry before storing audio beyond the page. The [synthetic browser scenario](../apps/web/e2e/respondent/voice-fixture.ts) uses intercepted failures and a real signed upload to disposable Storage.

## 2026-11-22, Platform, Gate 1 acceptance

Done. Merged the private-audio worker adapter and signed session resume. Browser checks verified that a signed-in respondent can reopen at the next unanswered question. Added [the full disposable study scenario](../apps/web/e2e/gate1-slice.spec.ts) to connect researcher email and MFA, study launch, respondent email and consent, matching, four private recordings, return sign-in, quality hold and the redacted researcher view.

Next. Verify both disposable email variants, qualify the redaction configuration, run the live synthetic transcription workflow and verify the dedicated hosted study journey.

Needs from others. Configure an approved transcription key for the live synthetic GitHub Actions check. The disposable journey uses a repository transcription fake and a fixed synthetic redaction projection.

Contract or schema changes. None in the full browser scenario.

Risks. The default worker keeps transcripts private until a qualified redaction configuration is available. Live transcription and the hosted Gate 1 journey remain unverified.

## 2026-11-22, Platform, Gate 1 hosted rollout

Done. The full four-question study passed on disposable Supabase with both delivered email formats and passed locally on Windows. The desktop researcher launched one study. The mobile respondent saw only their own invitation, saved four private browser recordings, signed back into the same account and submitted to quality hold. Researcher tracking updated, and the trusted worker published only the explicitly qualified synthetic projection. [Main integration PR](https://github.com/rachelgonsalves821/EnvoiLabs/pull/67)

Done. The five-minute expiry job passed a real local Inngest schedule and a forced retry with an unchanged UTC cutoff. The dedicated hosted Supabase project `ndanhlqodsgfipwrulji` has all 16 migrations through `20261121235000`. Vercel deployment `dpl_DQeipo4fkEvFx3CeMwp88bJPEHAT` is ready on preview commit `e2cdfe68`, with the same source tree as main `23506d67`. Test launch is enabled on the dedicated preview branch. [Expiry evidence](https://github.com/rachelgonsalves821/EnvoiLabs/pull/69) · [Hosted preview](https://envoilabs-git-preview-gate-0-rachelgonsalves821s-projects.vercel.app)

Next. Complete the hosted browser rehearsal, run the live synthetic transcription check, and qualify a private redaction configuration against independent recognized speech. Hosted expiry can be observed after the preview is connected to Inngest.

Needs from others. Live synthetic transcription requires an approved OpenAI or Groq project key in GitHub Actions.

Contract or schema changes. Applied ten existing Gate 1 migrations on the dedicated preview database.

Risks. Gate 1 remains open. Researcher transcript publication requires qualified redaction. The disposable integration uses synthetic redaction results and fake transcription.

## 2026-11-22, Platform, Gate 1 worker acceptance

Done. The native worker verified all five checked-in synthetic recordings through private Storage, digest validation, the primary transcription fake, deterministic redaction and saved provider metadata. The typed case passed without recording or vendor consent and used the same redaction step. [IT-1.2 fixture evidence](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/45035427938)

Done. The answer queue drain recovered committed work in a real local Inngest schedule after a simulated outage. The database integration raced two workers and verified one private result, then an idle replay. [IT-1.5 integration and schedule](https://github.com/rachelgonsalves821/EnvoiLabs/pull/73)

Next. Finish the signed-in hosted study, run transcription against an approved provider on synthetic recordings, and qualify redaction on independent recognized speech. Verify hosted job scheduling once its Inngest environment is connected.

Needs from others. An approved transcription project key for the GitHub Actions synthetic run.

Contract or schema changes. The scheduled drain uses the existing durable answer queue and lease RPCs.

Risks. Researcher publication of genuine transcripts remains disabled. The hosted queue drain requires explicit configuration.

## 2026-11-22, Platform, Gate 1 hosted study acceptance

Done. Chrome completed the synthetic four-question study on deployment `dpl_DQeipo4fkEvFx3CeMwp88bJPEHAT` at `e2cdfe68`. The MFA researcher launched once without payment. The respondent completed profile and privacy choices, received the matching invite, saved one recording through private Storage and three typed answers, reopened question three in a new tab within the signed-in session, and submitted to quality hold at 15:18 UTC. Researcher tracking moved from zero to one complete with no transcript visible. Scoped database readback verified one accepted invite, four answer rows, four consent grants and zero published transcript rows. Temporary access and TOTP factors were revoked. [Hosted evidence](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063)

Done. Both controlled accounts received and consumed real sign-in emails at 14:14 UTC. The researcher completed a second delivered sign-in with MFA at 15:15 UTC. The respondent request immediately after that retry was rate-limited. The successful hosted study used official one-time Supabase test links for the previously verified accounts. The disposable browser scenario separately proves progress restoration after a fresh delivered sign-in. [Disposable study](https://github.com/rachelgonsalves821/EnvoiLabs/pull/67)

Done. Provisioned the approved $0 Inngest resource. The [five-minute settings](https://github.com/rachelgonsalves821/EnvoiLabs/pull/76) passed a real local tick with both jobs active.

Next. Finish the preview-only hosted Inngest connection, observe the expiry job, run real-provider synthetic transcription, and qualify a redaction configuration before genuine transcript publication.

Needs from others. An approved transcription project key in GitHub Actions and approval to transfer the current non-production Inngest signing key to the dedicated Vercel preview branch.

Contract or schema changes. None in this verification. The request and response shapes remain those used by the tested preview.

Risks. The independent redaction trial on 272 recognized synthetic excerpts missed publication thresholds. Gate 1 remains open for live processing and redaction qualification. [Frozen independent redaction results](https://github.com/rachelgonsalves821/EnvoiLabs/pull/75)

## 2026-11-22, Platform, Gate 1 live speech verification

Done. The live synthetic workflow now requires two fixture-specific speech terms from each recording. A local run used an actual Chromium capture and mocked provider responses. All six files passed. The evidence reports the provider, model, latency, estimated cost and term counts. It excludes transcript text.

Next. Dispatch the workflow with an approved provider credential and record its exact result.

Needs from others. Add an approved OpenAI or Groq project key to GitHub Actions.

Contract or schema changes. None.

Risks. The hosted provider and the output it produces for independent redaction qualification still need verification.

### 2026-11-22 — Gate 1 private playback and redaction follow-up

Done. The respondent browser test now starts and pauses the local audio explicitly after a failed upload. It checks that playback keeps the same local recording URL and leaves the upload and confirmation counts unchanged. Both local browser auth cases and both private-answer worker checks passed. Two more offline redaction experiments on known synthetic transcripts provided limited gains and did not qualify answer publication. See [ADR 0005](adr/0005-spoken-redaction-v2.md).

Next. Run the browser checks in GitHub and retain the redaction hold until a candidate passes independently.

Needs from others. See [Gate 1 evidence and hosted prerequisites](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. None.

Risks. Live speech recognition and independent redaction qualification remain open.

### 2026-11-22 — Gate 1 transcription formatting and classifier evaluation

Done. Paired local tests on 60 known synthetic recordings found no contact-format improvement from a Whisper prompt. The local PII classifier added some fully masked spans to V2 and also increased alterations to useful evidence and clean text. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Run the approved provider check on synthetic audio and use representative recognized speech to evaluate the next private redaction candidate.

Needs from others. See the [hosted prerequisites](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. None.

Risks. Real-provider audio and independent publication qualification remain outstanding.

### 2026-11-22 — Gate 1 spoken contact recovery

Done. The offline contact pass fully masked 123 of 140 phone spans and 112 of 140 email spans on 272 known speech transcripts, up from 82 and 68 with V2. Evidence and clean edits matched V2 on both known corpora. Seven focused tests passed. The separate official OpenAI Privacy Filter experiment also missed the required thresholds. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Evaluate recognition and redaction using approved live-provider synthetic transcripts. Use the independent holdout after freezing a candidate.

Needs from others. See the [hosted prerequisites](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. None.

Risks. Contact and identity coverage remain below the gate thresholds. Publication stays on hold.

### 2026-11-22 — Gate 1 preservation of research labels

Done. The offline redaction evaluator now measures whether explicit menu and shop labels can stay visible. On 272 known excerpts, the policy reduced alterations from six useful spans to two and from 14 clean excerpts to 10. Full masking counts matched the contact-only policy across both known corpora. Eleven focused tests passed. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Verify live-provider speech and score a frozen candidate on the independent holdout once contact and identity coverage improve.

Needs from others. See the [hosted prerequisites](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. None.

Risks. Publication stays gated on independent coverage and precision.

### 2026-11-22 — Gate 1 local speech through private storage

Done. A disposable Supabase rehearsal ran the Gate 1 answer worker against the five checked-in synthetic recordings and a fresh Chrome WebM recording. Whisper Base.en CPU int8 with local FFmpeg recognized both expected terms in all six inputs after the worker verified bytes retrieved from private Storage. The worker persisted local model and latency metadata and withheld all six unqualified voice projections. Typed intake bypassed speech recognition when voice permissions were denied. [IT-1.2 evidence](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063)

A separate 60-recording test found that a larger local model recovered some additional names while retaining fewer phone values and returning words on all three negative audio controls. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Run the credentialed workflow and the Vercel worker against synthetic audio.

Needs from others. See the hosted prerequisites in [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. None.

Risks. Hosted provider output and redaction qualification remain outstanding.

### 2026-11-22 — Dedicated Gate 1 preview release

Done. The `preview/gate-0` branch fast-forwarded to `bbb87dda71dc670077bbf61dd4ac7886ccee65f7`, which has the same source tree as main `d91cbab66470f73a0034bdf141f62fabe40c400c`. Vercel deployment `dpl_65bRxBnYAhGRyAWmfxUeSCdQE3th` is Ready. The build log confirms the respondent signup, researcher sign-in and scheduler routes. All three require Vercel sign-in on both preview domains. The completed signed-in study rehearsal remains tied to the earlier immutable build in issue #4. [Dedicated preview](https://envoilabs-git-preview-gate-0-rachelgonsalves821s-projects.vercel.app) · [Immutable build](https://envoilabs-nfpytpowq-rachelgonsalves821s-projects.vercel.app)

Next. Verify the hosted speech provider and scheduled jobs on the dedicated branch once their credentials are ready.

Needs from others. See [hosted prerequisites in issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. None.

Risks. Signed-in verification for the latest build and independent publication qualification remain outstanding.

### 2026-11-22 — Gate 1 dictated email formats

Done. The offline redaction comparison now accepts the pinned authored text and its recognized counterpart. The email rule raised full coverage from 128/140 to 139/140 on authored text and from 112/140 to 115/140 on recognized speech. Each of the 13 focused tests passed. [Paired development results](adr/0005-spoken-redaction-v2.md)

Next. Run the credentialed synthetic speech check and evaluate a frozen policy on independent recognition output.

Needs from others. See the hosted prerequisites in [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. None.

Risks. Recognized phone, email and identity coverage remain below the redaction thresholds.

### 2026-11-22 — Gate 1 speech casing comparison

Done. The offline evaluator now measures learned capitalization and punctuation for contextual redaction and keeps masks aligned to the original text. In the 272-excerpt known speech replay, it raised full employer masks from 29/60 to 46/60 and names from 15/60 to 22/60. It altered one additional evidence span and two additional clean excerpts. Sixteen focused tests passed. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Run the configured live provider on controlled synthetic recordings and qualify a frozen private policy against independent speech.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for the hosted prerequisites.

Contract or schema changes. None.

Risks. Publication stays gated on independent recall and evidence preservation.

### 2026-11-22 — Gate 1 identity boundary evaluation

Done. Completing existing detections raised full masks from 22/60 to 27/60 for names and from 27/36 to 32/36 for schools on known recognized speech. Evidence and clean edits matched the casing baseline. All 20 focused tests passed. A separate diagnostic found that 35 of 38 incompletely masked names in the casing baseline contained extra words after recognition. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Verify live synthetic recognition and evaluate a frozen candidate against independent speech.

Needs from others. See the hosted prerequisites in [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. None.

Risks. Independent publication thresholds remain outstanding.

### 2026-11-22 — Gate 1 fragmented person names

Done. The offline evaluator masks fragmented names inside explicitly supported person slots. Across 272 known recognized excerpts, full name masks increased from 27/60 to 34/60, with the same measured edits to research evidence and clean clips. The 18 separate development controls had the same coverage and evidence edits as the baseline. All 26 focused tests passed. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Verify live synthetic speech and test a frozen policy against independent recognition output.

Needs from others. See the hosted prerequisites in [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. None.

Risks. The independent recall thresholds and hosted speech and scheduler checks remain open.

### 2026-11-22 — Gate 1 spoken phone gaps

Done. Adding bounded phone spans raised full phone masks from 123/140 to 132/140 on 272 known recognized excerpts and from 5/10 to 9/10 on independent development controls. Clean and evidence edits matched the baseline in both comparisons. All 32 focused tests passed. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Run the approved live speech check and evaluate a frozen policy against independent recognition.

Needs from others. See the [hosted prerequisites in issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. None.

Risks. Recall still falls short of the gate targets, and hosted checks remain unverified.

### 2026-11-22 — Gate 1 spoken email separators

Done. The offline email rule raised full masks from 115/140 to 132/140 on known recognized speech and from 139/140 to 140/140 on paired authored text. On separate development controls, email masks increased from 4/10 to 10/10 while the combined policy continued to edit 9/10 clean clips and 11/34 evidence spans. All 38 focused tests passed. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Use the independent controls to diagnose excess masking and run synthetic recordings through the approved live provider.

Needs from others. See the [hosted prerequisites in issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. None.

Risks. Independent recall and evidence preservation remain below publication readiness.

### 2026-11-22 — Gate 1 public website precision

Done. The offline website guard reduced clean edits from 9/10 to 1/10 and evidence edits from 11/34 to 2/34 in the email development controls. The 272 known speech clips and a separate set of 16 public-site and mixed-identity clips produced the same measured results as their baselines. All nine private spans in the mixed set remained fully masked. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Run the approved provider on synthetic recordings and evaluate recall and precision against independent recognized speech.

Needs from others. See the [hosted prerequisites](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. None.

Risks. Independent publication qualification remains open.

### 2026-11-22 — Gate 1 explicit employment spans

Done. The offline employment comparison increased full employer masks from 46/60 to 57/60 on the 272 known recognized excerpts, with the same evidence and clean edits. The 20 separate development controls matched the baseline and still show excess masking. All 49 focused tests passed. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Validate hosted speech and improve recall and evidence preservation before freezing an independent publication candidate.

Needs from others. See the [hosted prerequisites in issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. None.

Risks. The held-out gate and hosted checks remain open.

### 2026-11-22 — Gate 1 confirmed personal names

Done. Explicit name fields and paired confirmation cues raised full name masks from 34/60 to 52/60 on known recognized speech, with the same evidence and clean edits. Separate development controls matched the baseline, including 10/10 full name masks and 11/32 evidence edits. All 55 focused tests passed. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Run the hosted synthetic speech test and improve recall and evidence preservation ahead of independent qualification.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for the hosted prerequisites.

Contract or schema changes. None.

Risks. Independent publication qualification and hosted acceptance remain open.

### 2026-11-22 — Gate 1 commercial references in transcripts

Done. The offline comparison preserved known sensitive-span coverage, reduced changes to annotated research evidence from 3/36 to 0/36 across the known speech set, and reduced altered clean excerpts from 12/36 to 6/36. Separate name controls had matching sensitive coverage and fewer evidence and clean edits. All 58 focused tests passed. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Recover private names and contact details that are still missed and qualify a frozen policy against independent recognized speech.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for hosted prerequisites.

Contract or schema changes. None.

Risks. Sensitive-span recall still falls short of the publication thresholds. The independent qualification set remains sealed.

### 2026-11-22 — Gate 1 spoken addresses

Done. Bounded location cues, spoken number recovery and consecutive unit fields increased full address coverage from 21/36 to 33/36 on known speech. Two separate address development sets improved to 12/12 and 10/10. A third precision set remained at 5/6. Clean and evidence edit counts matched the baseline. All 62 focused tests passed. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Recover remaining private spans, then freeze and independently qualify the publication candidate.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for hosted prerequisites.

Contract or schema changes. None.

Risks. The new evidence comes from development cases. Private publication remains gated.

### 2026-11-23 — Gate 1 shared redaction pipeline

Done. The offline comparison and the private synthetic entry point share the same span policy. The score continues to use fixed-width masks. The private renderer replaces those exact intervals with readable markers and fails on invalid offsets. The comparison records the shared pipeline's source hash. All 65 focused tests passed. [Replay instructions](../packages/ai/evals/redaction/contextual/spoken_v3/README.md)

Next. Close the remaining recall gaps, bind the pinned detectors in the private worker, and verify publication with a qualified policy and synthetic inputs.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for the hosted prerequisites.

Contract or schema changes. None.

Risks. The shared policy remains unqualified. The live worker does not render or publish it.

### 2026-11-23 — Gate 1 pinned local redaction models

Done. The scorer and local renderer can use the same Presidio rules, pinned contextual model and casing model. The loader verifies model assets and rejects text beyond the contextual or casing model limits. The synthetic renderer masked a test email while preserving the checkout feedback. All 69 focused tests passed. [Replay instructions](../packages/ai/evals/redaction/contextual/spoken_v3/README.md)

Next. Close remaining recall gaps and verify how supported long answers are handled before freezing the private publication candidate.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for hosted prerequisites.

Contract or schema changes. None.

Risks. Inputs beyond the model limits stay private. The live worker remains disconnected and independent qualification is pending.

### 2026-11-23 — Gate 1 long-answer redaction

Done. The local candidate handles an over-limit answer as overlapping sections and validates each source span before projecting it back. The caller receives a result only after every section succeeds. All 72 focused tests passed, including an identity crossing a split and errors late in a long answer. [Replay instructions](../packages/ai/evals/redaction/contextual/spoken_v3/README.md)

Next. Measure independently annotated long answers alongside short recognition output before approving the private publication policy.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for hosted prerequisites.

Contract or schema changes. None.

Risks. The long-answer path has synthetic evidence. Researcher publication remains gated.

### 2026-11-23 — Gate 1 corroborated spoken mailboxes

Done. The offline comparison matches broken mail syntax to an explicit mailbox label or a separately detected phone and nearby contact wording. It raised full email masks from 132/140 to 140/140 on known speech. Other coverage and evidence edits matched the baseline. An earlier development set improved from 2/10 to 10/10 after revising the cues. A new set improved from 4/8 to 5/8 with matching clean and evidence edits. The five long-answer controls matched their baseline. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Improve recall on fresh mailbox wording, phone numbers and names before freezing a candidate for qualification.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for hosted prerequisites.

Contract or schema changes. None.

Risks. The known email result does not establish independent recall. Transcript publication remains closed.

### 2026-11-23 — Gate 1 corroborated spoken phone values

Done. The offline comparison recovers noisy digits using a direct phone label or corroborated contact language. Full masks rose from 132/140 to 140/140 on known speech and from 5/10 to 10/10 on development controls used to revise the cues. A separately authored set matched its previous 5/8 masks. Clean and evidence edit counts matched across the short and long answer comparisons. All 83 focused tests passed. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Recover more names and measure contact generalization before freezing the independent publication candidate.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for hosted prerequisites.

Contract or schema changes. None.

Risks. The known phone result does not establish independent recall. Transcript publication remains closed.

### 2026-11-23 — Gate 1 names in personal records

Done. Bounded badge and receipt cues raised full name masks from 52/60 to 56/60 on known recognized speech. A development set used to refine the cues rose from 8/10 to 9/10. A separate set stayed at 7/8. Other entity coverage and evidence alteration matched, including the five long controls. All 88 focused tests passed. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Recover remaining private identity spans and evaluate a frozen candidate independently before the publication rehearsal.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for hosted prerequisites.

Contract or schema changes. None.

Risks. The known development score remains one fully masked name below the numeric target. The independent qualification corpus remains sealed.

### 2026-11-23 — Gate 1 independent qualification checker

Done. Added a private synthetic scorer for the exact full-answer candidate. It verifies a precommitted manifest, pinned model assets, code, environment and paired transcript annotations. The aggregate report measures recall, clean and evidence edits, ASR omissions and withheld answers. Failed answers and recognition omissions stay in the paired coverage denominator. Independent claims require a repository-approved digest. The known paired replay confirmed the recognized name and address gaps. [Qualification instructions](../packages/ai/evals/redaction/contextual/spoken_v3/README.md#independent-qualification)

Next. Close remaining gaps, freeze the candidate for the custodian's independent data, and verify researcher publication only after qualification.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for hosted prerequisites.

Contract or schema changes. None.

Risks. The development replay does not qualify publication. The independent corpus remains sealed.

### 2026-11-23 — Gate 1 street address endpoints

Done. The offline candidate recognizes damaged street types after residence, appointment and delivery cues. A walk endpoint needs a preceding landmark, and generic turn directions need accompanying delivery language. Full masks rose from 33/36 to 36/36 on known speech and from 4/8 to 8/8 on the development controls used to revise the cues. A separate set stayed at 2/6. The new rule did not fire on any of the 14 public or non-address control examples. All 100 focused tests passed. [ADR 0005](adr/0005-spoken-redaction-v2.md)

Next. Resolve remaining name and address generalization gaps and run the independently frozen candidate before researcher publication.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for hosted prerequisites.

Contract or schema changes. None.

Risks. Full coverage on the known address set does not establish independent coverage. The independent corpus remains sealed.

### 2026-11-23 — Gate 1 publication policy boundary

Done. Gate 1 completion requires a matching active redaction policy digest to publish a researcher projection. The database stores the policy alongside the completion, checks it again at read time and keeps the existing consent, lease and source-version checks. Legacy completion calls can still save private processing. Synthetic fixtures approve a test digest only in the disposable database.

Next. Bind a qualified private redactor to the worker and rehearse actual publication after an independent pass.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for hosted prerequisites.

Contract or schema changes. The worker completion call adds an optional policy digest. The internal policy record links active policies to qualification evidence. The migration has no approved policy rows.

Risks. The configured hosted worker still has no redactor and publication remains closed.

### 2026-11-23 — Gate 1 private redactor handoff

Done. The explicitly configured command-line worker can pass an answer to the pinned on-host redactor over a bounded process pipe. The redactor verifies the approved manifest, passing report and exact policy before reading the answer. The worker checks the response digests and keeps failures private. [Private worker handoff](../packages/ai/evals/redaction/contextual/spoken_v3/README.md#private-worker-handoff)

Next. Complete independent qualification and run the researcher publication rehearsal on the trusted deployment.

Needs from others. See [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) for hosted prerequisites.

Contract or schema changes. The qualification report records its canonical policy digest. No database change.

Risks. No independent policy is active. The hosted job has no redactor configuration.

### 2026-11-23 — Gate 1 grouped transcript contract

Done. Defined a versioned researcher response for redacted answers grouped by a study-local respondent number. The only profile field is a nullable student flag. The existing flat transcript schema remains supported.

Next. Add the consent-scoped database projection and update the researcher panel and acceptance test.

Needs from others. Platform and Researcher use the new response for the grouped viewer. The existing flat endpoint keeps its response shape for current callers.

Contract or schema changes. Added `ResearcherTranscriptListV2Schema`.

Risks. The contract does not grant profile or transcript access. The database projection still needs to be wired and tested before enabling the grouped view.

### 2026-11-23 — Gate 1 researcher transcript grouping

Done. The researcher tracking screen groups redacted answers by a study-local respondent number and shows the student flag when available. The grouped response reuses MFA, organization, consent and active-policy publication checks. It exposes no respondent identifiers or free-form profile values. Older callers retain the flat response.

Next. Rehearse grouped researcher publication on the protected preview after the redactor passes independent qualification.

Needs from others. The hosted speech and scheduler settings are still tracked in [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. Added the scoped read function and wired the version two response. No additional profile-table grants.

Risks. The synthetic publication test uses a test policy solely in the disposable environment.

### 2026-11-23 — Gate 1 exact qualification receipt

Done. Publishing a Gate 1 transcript requires the active policy digest and its registered qualification report digest. The database stores both and checks them again whenever a researcher reads the transcript. Missing or mismatched reports leave the answer private, and replacing a report hides projections made under the previous report.

Next. Use a passing independent report for the protected preview publication rehearsal.

Needs from others. Hosted speech and scheduling credentials are tracked in [issue #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063).

Contract or schema changes. The worker completion call accepts an optional qualification digest. Existing callers can still complete private processing.

Risks. Earlier job-backed projections without a recorded report digest stay hidden. The preview has no existing published projections or approved report.

### 2026-11-23 — Gate 1 hosted scheduler and speech verification

Done. The hosted expiry and private answer schedules both completed. The scheduled worker processed three synthetic typed answers privately and transcribed a separate pinned speech fixture with OpenAI `gpt-transcribe`. Both expected fixture terms were present, latency was 611 ms and estimated cost was 300 micros. The voice result stayed private. The separate [live speech smoke](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/45280585136) passed all six synthetic recordings, including Chromium audio.

Next. Score the frozen independent redaction policy and rehearse publication only after qualification.

Needs from others. None for the running qualification test.

Contract or schema changes. None.

Risks. A successful private worker run provides no evidence of researcher publication.

### 2026-11-23 — Gate 1 independent redaction result

Done. OpenAI transcribed all 288 independently authored synthetic recordings. The frozen policy was scored against both authored and recognized transcripts. The recognized set fully masked 114/114 phones, 96/113 emails, 43/49 names, 42/49 employers and 37/48 addresses. The authored set fully masked 108/114 phones, 100/113 emails, 48/49 names, 47/49 employers and 44/48 addresses. The policy altered 20/304 recognized evidence spans and 11/24 clean recognized controls. Neither set had withheld answers. The independent qualification failed.

Next. Improve full-span masking and preserve study evidence using separate development fixtures. Freeze the revised policy before another independent qualification and hosted publication rehearsal.

Needs from others. None for redaction development.

Contract or schema changes. None. The manifest fingerprint registers the independent scoring input.

Risks. Publication remains closed. The independent fixture text stays private and is excluded from development.

### 2026-11-23 — Gate 1 second independent redaction result

Done. OpenAI transcribed 242 freshly and independently authored synthetic recordings. The candidate was frozen after the literal-contact, address, employer and name changes. The independent custodian verified all recognized transcripts and annotations before scoring. Full-span masks below use the authored count in each column so recognition omissions count against paired coverage.

| Sensitive span | Required | Authored text | Recognized speech |
| --- | ---: | ---: | ---: |
| Phone | 99% | 124/124 | 124/124 |
| Email | 99% | 125/125 | 58/125 |
| Person | 95% | 61/61 | 45/61 |
| Employer | 95% | 57/58 | 42/58 |
| Address | 100% | 56/58 | 42/58 |

Speech recognition omitted two names and one employer. The policy altered 30 of 258 evidence spans and 17 of 60 clean controls in recognized transcripts. It altered 28 of 258 evidence spans and 18 of 60 clean controls in authored text. It withheld zero answers in both runs. The qualification failed. [Frozen manifest and results](https://github.com/rachelgonsalves821/EnvoiLabs/pull/112)

Next. Reproduce the speech-formatting failures in development, improve full-span recall and evidence preservation, then use a fresh independent test before a hosted publication rehearsal.

Needs from others. None for the current redaction work.

Contract or schema changes. None. The manifest registers test inputs. Publication still requires a passing report and a matching active database policy.

Risks. The current candidate leaves portions of private information visible in synthetic inputs. Researcher transcript publication remains disabled.

### 2026-11-23 — Gate 1 spoken contact and address development

Done. Improved dictated email parsing for mixed spoken and written separators, explicit email labels and an adjacent validated phone number. Added bounded street and unit recognition. On a development replay of the completed second benchmark, the email count improved from 58 to 93 of 125 and the recognized address count improved from 42 to 43 of 58. The replay still altered 17 of 60 clean answers and 30 of 258 evidence spans. All 133 spoken-redaction unit tests passed against the combined changes. [Contact fixes](https://github.com/rachelgonsalves821/EnvoiLabs/pull/116)

Next. Improve recall and evidence preservation on development data, then evaluate a new frozen candidate on a separate independent benchmark.

Needs from others. None for the current development checks.

Contract or schema changes. None.

Risks. The development scores fall below the PRD recall floors. Researcher transcript publication remains disabled.

### 2026-11-23 — Gate 1 redaction development and qualification readiness

Done. Receipt seller and full postal address handling passed 144 pinned tests and the required GitHub checks. The isolated database test port fix passed its database, CI and disposable sign-in checks. On the 242-recording development replay, full masks on authored denominators were 124/124 phones, 94/125 emails, 45/61 names, 42/58 employers and 43/58 addresses. The paired floors require 123, 124, 58, 56 and 58 full masks respectively. The recognized spans leave a margin of one visible miss for phone, email, person and employer, and require every visible address span. [Receipt and postal change](https://github.com/rachelgonsalves821/EnvoiLabs/pull/135) · [Database check isolation](https://github.com/rachelgonsalves821/EnvoiLabs/pull/136)

Next. Improve masking on development cases, evaluate a frozen candidate against the sealed independent benchmark, then rehearse hosted researcher publication with the matching policy and qualification report. The alternate speech model added no offset-safe redactions on primary text. A role-specific detector improved address masking on one development set and masked additional protected evidence on a separate stress set. Both remain experimental. [Development evidence](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7120271896)

Needs from others. None for the current development checks.

Contract or schema changes. None.

Risks. The candidate still falls below the paired recall floors. Researcher transcript publication remains disabled.

### 2026-11-24 Gate 1 combined redaction replay

Done. Replayed the guarded address, email and identity additions on the 242-recording development set. Speech full masks on the paired denominators were 124/124 phones, 97/125 emails, 47/61 names, 42/58 employers and 53/58 addresses. The additions left the measured evidence and clean-answer masking at the baseline levels of 29/258 and 17/60. The quote model was evaluated on annotation-selected gaps, so its performance across all answer types remains unverified. Two complementary local token classifiers added no complete name or employer masks. [Combined replay](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7134036614) · [Complementary detectors](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7134223322)

Next. Close the remaining speech redaction and evidence-preservation gaps, then run the sealed independent benchmark against a frozen candidate. Rehearse hosted researcher publication only after a passing report.

Needs from others. None for the current development checks.

Contract or schema changes. None.

Risks. The replay falls below the paired recall floors. Researcher transcript publication remains disabled.

### 2026-11-24 Gate 1 qualification report validation

Done. The private worker verifies the authored and speech totals against the existing recall floors before loading a model or reading answer text. It rejects missing controls, withheld answers and mismatched paired totals even when the pass flag is set. All 148 spoken-redaction tests passed, including a synthetic contradictory report that stopped before model loading or private input.

Next. Freeze the improved redaction candidate with the updated validation code, run independent qualification, then verify hosted researcher publication.

Needs from others. None for redaction development and testing.

Contract or schema changes. None. The next qualification must use the updated worker source fingerprint.

Risks. Researcher transcript publication remains disabled pending a passing independent result and the hosted rehearsal.

### 2026-11-24 Gate 1 concurrent browser requests

Done. The production-build Chromium test sent concurrent duplicate requests for study launch, invite acceptance and the second voice answer confirmation. Both calls returned the same successful response for each action. The database recorded one launch transition, one invite acceptance, one interview and exactly four distinct answers. After a fresh email sign-in the respondent resumed at question three, submitted, and entered quality hold. The researcher saw four redacted test transcripts only after the disposable fixture worker processed them. [IT-1.1, IT-1.3 and IT-1.5](../apps/web/e2e/gate1-slice.spec.ts)

Next. Repeat the qualified publication journey on the dedicated hosted preview once the redactor passes independently.

Needs from others. None for this browser check.

Contract or schema changes. None.

Risks. This trace uses a fixture redactor. The live publication check still requires the independently qualified policy.

### 2026-11-24 Gate 1 protected preview sync

Done. Vercel marked preview commit `b5af43a42c1d106afcc9cb04724486d8a74ab790` ready. It has the same source tree as main `e99559689c373d81b21a729b99c97ca790f0a7cc`. On both preview addresses, unauthenticated requests to respondent signup, researcher sign-in and the job endpoint redirected to Vercel sign-in. [Deployment receipt](https://vercel.com/rachelgonsalves821s-projects/envoilabs/EwMUgNpDXuEbFNhsbYEiduJ9xCLA) · [Gate 1 evidence](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7141104642)

Next. Qualify redaction independently and rehearse researcher publication on the protected preview.

Needs from others. None for this preview check.

Contract or schema changes. None.

Risks. The deployment and protection checks cover the new build. Researcher transcript publication still needs a qualified redactor and a signed-in rehearsal.

### 2026-11-24 Gate 1 integration evidence

The hosted seeded study verified researcher launch and tracking, eligible respondent access, private voice and typed answers, saved progress, and quality hold. The credentialed synthetic speech check passed separately. [Hosted study](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) · [Live speech](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/45280585136)

| Integration test | Verified evidence |
| --- | --- |
| IT-1.1 | The disposable production-build browser test covers a desktop researcher and a phone-sized respondent. Home shows the eligible invite, hides another account’s invite, and restores the same account after fresh sign-in. [Browser test and review](https://github.com/rachelgonsalves821/EnvoiLabs/pull/149) |
| IT-1.2 | Five stored synthetic fixtures exercise primary transcription, timeout and fallback, provider metadata, consent checks, typed bypass and redaction-gated visibility. Hosted researcher visibility with a qualified redactor is pending. [Fixture worker checks](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/45035427938) |
| IT-1.3 | The browser closes mid-interview, signs in again, and resumes at question three. [Browser test and review](https://github.com/rachelgonsalves821/EnvoiLabs/pull/149) |
| IT-1.4 | The disposable database test verifies the 24-hour expiry boundary, repeat behavior, audit entries, and protection of completed and unrelated interviews. [Expiry test](../packages/db/tests/gate1_interview_expiry.sql) |
| IT-1.5 | Concurrent launch, invite acceptance and answer confirmation converge on one durable result. A separate test recovers an answer committed before dispatch failed and verifies idempotent retry. Pending and failed redaction stay private in the fixture worker checks. [Concurrent browser requests](https://github.com/rachelgonsalves821/EnvoiLabs/pull/149) · [Dispatch failure and retry](https://github.com/rachelgonsalves821/EnvoiLabs/pull/73) · [Fixture worker checks](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/45035427938) |

Desktop Chromium and iPhone 13-emulated WebKit passed all four production-build accessibility checks at source tree `89081578fb57fd596e0cb8532525a823a110f48d`. These checks cover keyboard focus through request, error and retry, responsive layouts, touch targets and reduced motion. Sign-in responses were synthetic. [Integration and accessibility evidence](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7149577921)

Next. Pass independent redaction qualification and use the matching policy and report to verify a signed-in researcher sees only redacted results on the protected preview. The abandoned-audio cleanup also awaits the shared database migration and integrated rehearsal. [Qualification result](https://github.com/rachelgonsalves821/EnvoiLabs/pull/112) · [Cleanup draft](https://github.com/rachelgonsalves821/EnvoiLabs/pull/148)

Needs from others. Platform owns the shared cleanup migration. No account-holder action is needed for the current qualification work.

Contract or schema changes. None in this status update.

Risks. The accessibility and fixture worker results use synthetic cases. The researcher publication gate remains closed.

## 2026-11-25 Gate 1 redaction and cleanup checkpoint

Done. Recorded the bounded development redaction replay across 242 synthetic recordings and checked proposed changes on separate synthetic controls. The composed development candidate fully masked 124/124 phones, 115/125 emails, 54/61 names, 42/58 authored employers, and 53/58 addresses. Redaction altered 28 of 258 annotated research spans. Follow-up experiments found both coverage and evidence-preservation regressions. [Development and transfer evidence](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7171430305)

Done. Opened a standalone draft that combines the expired-audio scheduler and the handoff migration. It passed CI, database checks, and both local auth modes on head `d2c4cefe158a7ad4f245de9e8fb9925b6c95f739`. The disposable rehearsal verified Storage removal, preservation of active and confirmed audio, a late upload removed on the next sweep, and an empty repeat. [Cleanup draft and checks](https://github.com/rachelgonsalves821/EnvoiLabs/pull/198#issuecomment-7171990489)

Next. Pass independent redaction qualification before verifying researcher publication on the protected preview. Integrate the cleanup draft in the coordinated order and repeat the synthetic cleanup check on the protected preview.

Needs from others. The coordinator owns the cleanup integration sequence. No account-holder action is needed for the current qualification work.

Contract or schema changes. This documentation change records the draft selector migration. The protected preview cleanup option is still off.

Risks. The open-development redaction comparison is below the qualification thresholds. The separate independent dataset remains sealed, and researcher publication remains gated.

## 2026-11-26 · Gate 1 cleanup upgrade rehearsals

Gate 1 remains open. The standalone cleanup draft and the pinned Gate 2 stack were tested on two disposable local databases. In both, the Gate 1 selector was applied before 45 later-added migrations, including 32 with earlier version numbers. The completed migration history contained all 65 migrations. The upgraded schema passed 1,057 SQL assertions across 39 files once its standard synthetic seed was loaded. Real local Storage checks covered a confirmation holding the reservation lock past expiry, selective cleanup, late upload, and an empty repeat. [Upgrade and race evidence](https://github.com/rachelgonsalves821/EnvoiLabs/pull/198#issuecomment-7183303186)

A second run created confirmed, active, and abandoned audio before upgrading. Active and confirmed audio, the confirmation's checksum, and its pending processing job survived. Cleanup removed the abandoned object. A signed upload issued before the upgrade still worked after it, and cleanup removed that late object from the expired reservation. The repeat sweep was empty. [Pre-existing data evidence](https://github.com/rachelgonsalves821/EnvoiLabs/pull/198#issuecomment-7183361318)

The coordinator owns the integration sequence. The protected preview still needs its own cleanup rehearsal after integration. Independent redaction qualification and hosted researcher publication remain outstanding. No account-holder action is needed for this work.

### 2026-11-26 Gate 1 hosted scheduled audio cleanup

The protected Preview ran the tested tree from [#198](https://github.com/rachelgonsalves821/EnvoiLabs/pull/198) on source `ff3e34140bebc66802355c0684df3625f0496675`. All 20 migrations matched the isolated preview history, including selector `20261124013900`. The schedule removed the expired synthetic upload and a late upload made with a URL issued before expiry. The active and confirmed objects stayed present. An additional scheduled tick left the selector empty, and the synthetic fixture had zero processing jobs or published transcripts. The branch-only cleanup flag was removed afterward and the protected alias resolved to the Ready rollback deployment. The cleanup PR remains draft for ordered integration. Independent redaction qualification and the signed-in publication rehearsal remain open. [Hosted cleanup evidence](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7204841028)

### 2026-11-27 Gate 1 private audio and transcript protection

On a fresh disposable stack, anonymous, owner and unrelated respondent sessions, and both same-tenant and other-tenant AAL2 researcher sessions returned no private Storage bytes or object metadata. Direct creation and replacement failed. The app denied reservation reads and confirmation after expiry and denied new reservations, reads and confirmation after recording consent was withdrawn. Previously issued signed uploads could still write to their reserved paths. The expired-reservation cleanup removed those synthetic unconfirmed objects and preserved the confirmed control. [Private Storage evidence](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7229903338)

The standalone transcript receipt change passed all 508 SQL assertions after upgrading the preview's 20 migration versions and replaying migration 191. Both local researcher email sign-in modes passed the TOTP, receipt withholding, redacted transcript and withdrawal checks. The strict receipt migration is still awaiting protected-preview staging. [Database upgrade](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7228846887) · [Researcher browser tests](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7229023236)

The guarded single-alternate address comparison fully masked 55 of 58 addresses on 242 open synthetic recordings, with no added research masking. Requiring affirmative private-location wording on additions from a third transcript changed no masks in that set. It improved complete masks from 7 to 8 of 16 on a previously reviewed 24-recording set. Independent redaction qualification and the signed-in protected-preview researcher check remain open. [Development replay](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7230002123)
