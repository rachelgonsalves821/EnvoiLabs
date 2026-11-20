# Status and handoffs

Append-only. Newest entries at the bottom. Use the template in `docs/BUILD_PLAN.md` section 9.

## Gate checklist tracker

| Gate | Target | State | Evidence |
| --- | --- | --- | --- |
| Gate 0 Foundations | End of week 1 | Hosted preview pending | [Local auth](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44665100493), [browser](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44665100411), [database and drift](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/44665291413) |
| Gate 1 Vertical slice | End of week 3 | Not started | |
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
