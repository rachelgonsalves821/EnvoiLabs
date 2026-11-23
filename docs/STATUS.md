# Status and handoffs

Append-only. Newest entries at the bottom. Use the template in `docs/BUILD_PLAN.md` section 9.

## Gate checklist tracker

| Gate | Target | State | Evidence |
| --- | --- | --- | --- |
| Gate 0 Foundations | End of week 1 | Passed. Delegated sign-off recorded | [Build and browsers](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44952555314), [database](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44952555269), [local auth](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44952555268), [both hosted sign-ins on the same deployment](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7071655542) |
| Gate 1 Vertical slice | End of week 3 | Disposable and hosted study rehearsals passed. Live processing and redaction qualification in progress | [Browser study and private worker](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/45030028488), [hosted and integration evidence](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4#issuecomment-7079809063) |
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
