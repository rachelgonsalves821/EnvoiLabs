# Envoi Labs build plan

This plan defines the build sequence, ownership and acceptance criteria for Envoi Labs v1. The [PRD](PRD.md) defines product behavior. The eight-week schedule is a planning target. Gate evidence determines when the project advances. See the [build plan audit](BUILD_PLAN_AUDIT.md) for the rationale.

Read order for every agent, every session.
1. `AGENTS.md` (repo root), the shared rules
2. `docs/PRD.md`, the north star
3. This file
4. Your own brief in `docs/agents/`
5. `docs/STATUS.md`, the latest handoff notes from the other agents

## 1. The three agents

| Agent | Name | Owns | Brief |
| --- | --- | --- | --- |
| Agent 1 | Platform | Repo, CI, database, auth, contracts, domain logic and services (pricing, matching, state machines, quality, fraud), jobs, Stripe, Tremendous, admin, observability, the integration test suite | `docs/agents/AGENT_1_PLATFORM.md` |
| Agent 2 | Respondent | The respondent PWA, `packages/ui` (design system and the Echo), voice capture, push, points and payout UI, privacy controls | `docs/agents/AGENT_2_RESPONDENT.md` |
| Agent 3 | Researcher and AI | The researcher app, `packages/ai` (scoping, interviewer, analyst, transcription, redaction), reports, evals | `docs/agents/AGENT_3_RESEARCHER_AI.md` |

Rule of ownership. Each directory has exactly one owning agent (section 3). You may read anything. You may only change files you own, plus files listed as shared in section 4. If you need a change in another agent's area, open an issue titled `[NEEDS <AGENT>] <what>` and note it in `docs/STATUS.md`.

## 2. Stack (decided, do not swap without an ADR)

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript, `strict: true`, no `any` | One language across all code |
| Monorepo | pnpm workspaces plus Turborepo | Cached builds, clear package boundaries |
| App | Next.js (App Router), one app with route groups `(respondent)` at `/r` and `(researcher)` at `/app`, admin at `/admin` | One deploy, shared auth and UI |
| Database | Supabase Postgres with Row Level Security | Auth, storage and RLS in one place |
| Migrations | Supabase CLI SQL migrations in `packages/db/migrations`, generated TypeScript types | Schema is code |
| Query layer | Drizzle ORM over the same schema, types generated, no raw string SQL in app code except in `packages/db` | Type-safe queries |
| Validation and contracts | Zod schemas in `packages/contracts` | One source for API, events and LLM structured output |
| Background jobs | Inngest | Durable steps, retries, schedules, local dev server |
| Storage | Supabase Storage, private buckets, signed URLs | Audio files |
| Auth | Supabase Auth. A one-time email link opens the persistent respondent account. Researchers use an email link plus TOTP MFA. | Match the callback to the account type. |
| Payments | Stripe Checkout and webhooks | Researcher payment |
| Payouts | Prepaid Visa through a sandbox-verified provider adapter | Verify catalog, fees, recipient routing and tax handling before live use |
| LLM | Anthropic Claude via `packages/ai` provider interface | Structured outputs, tool use |
| Transcription | OpenAI primary and Groq Whisper fallback behind an interface | Pin and verify supported models for the deployment before enabling live calls |
| Redaction | Deterministic analyzer plus approved contextual pass | See section 11 for Presidio evaluation and private hosting |
| Push | Web Push (VAPID) with `web-push` | PWA notifications |
| Auth email delivery | Supabase Auth email with a dedicated sender before external study enrollment | Built-in delivery is limited to authorized internal test inboxes. |
| UI | React, CSS variables from design tokens, Radix primitives for accessible behavior, Phosphor icons, three.js or raw WebGL for the Echo | Design system fidelity |
| Testing | Vitest (unit and integration), Playwright (end to end, mobile and desktop projects), Testcontainers or Supabase local for DB tests | |
| Observability | Sentry for errors, pino structured logs, Inngest dashboard, an `llm_call` table for cost and latency | |
| Hosting | Vercel (app), Supabase (DB, storage, auth), Inngest Cloud | |

## 3. Repository layout and ownership

```
/
├─ AGENTS.md                         shared rules (all agents read, Agent 1 maintains)
├─ apps/
│  └─ web/                           Next.js app
│     ├─ app/(respondent)/r/...      Agent 2
│     ├─ app/(researcher)/app/...    Agent 3
│     ├─ app/admin/...               Agent 1
│     ├─ app/api/webhooks/...        Agent 1 (Stripe, Tremendous)
│     ├─ app/api/respondent/...      Agent 2 (thin route handlers calling packages)
│     ├─ app/api/researcher/...      Agent 3 (thin route handlers calling packages)
│     ├─ inngest/                    functions folder, one subfolder per owner
│     │  ├─ platform/                Agent 1
│     │  ├─ respondent/              Agent 2
│     │  └─ ai/                      Agent 3
│     └─ e2e/                        Playwright specs (Agent 1 owns the harness, each agent owns its specs)
├─ packages/
│  ├─ contracts/                     Zod schemas, event types, API types (Agent 1, changes by RFC)
│  ├─ db/                            schema, migrations, RLS policies, seed, typed queries (Agent 1)
│  ├─ core/                          pure domain logic, no I/O: pricing, matching rules, state machines, quality, points (Agent 1)
│  ├─ services/                      orchestration with I/O: calls core, reads and writes db, emits events and jobs (Agent 1)
│  │  └─ src/ai/                     persistence for transcripts, probes, briefs from chat, reports (Agent 3, uses Agent 1's db queries)
│  ├─ integrations/                  Stripe, Tremendous and web push clients (Agent 1, push sender by Agent 2)
│  ├─ ai/                            LLM and transcription providers, prompts, agents, redaction, evals (Agent 3)
│  ├─ ui/                            tokens, components, Echo (Agent 2; Agent 3 may add researcher components under ui/src/researcher)
│  └─ testing/                       factories, fixtures, fake providers, test DB helpers (Agent 1)
├─ docs/
│  ├─ PRD.md                         everyone updates per PRD rules
│  ├─ BUILD_PLAN.md                  Agent 1 maintains, others propose edits
│  ├─ STATUS.md                      everyone appends handoff notes
│  ├─ DEBT.md                        debt register, everyone appends
│  ├─ adr/                           architecture decision records
│  └─ agents/                        the three briefs
└─ .github/workflows/                CI (Agent 1)
```

## 4. Shared files and the contract process

These files are shared. Changes need the process below.

| File | Rule |
| --- | --- |
| `packages/contracts/**` | Contract change process (below) |
| `packages/db/migrations/**` | Only Agent 1 writes migrations. Others request via `[NEEDS PLATFORM] migration` issue with the exact columns needed |
| `docs/PRD.md` | Anyone, following PRD "How agents use this document" |
| `docs/STATUS.md`, `docs/DEBT.md` | Append-only by anyone |
| `package.json`, lockfile | Add dependencies only in your own package. Root dependencies only by Agent 1 |

**Contract change process.**
1. Write the proposed schema change in a PR limited to `packages/contracts` and its coordination notes, titled `[CONTRACT] <name>`.
2. Include a short note in `docs/STATUS.md` naming who is affected.
3. Agent 1 merges after CI passes. Breaking changes need a version suffix (`AnswerUploadedV2`) and a removal date for the old one. Record the removal date and handoff in the accompanying debt and status updates.
4. Consumers update in their own PRs.

Contracts frozen at Gate 0 (v1). After Gate 0, additive changes are fine. Breaking changes need Rachel's sign-off in the PR.

## 5. Working rules (all agents)

1. **Branches** `agent<N>/<req-id>-<short-name>`, for example `agent2/R-RESP-06-interview-screen`.
2. **Small PRs.** Under about 400 changed lines excluding generated files. One requirement or one sub-task per PR.
3. **Definition of done** for any PR.
   - Types pass, lint passes, unit tests pass, relevant integration tests pass.
   - New logic has tests. Pure functions in `packages/core` and `packages/ai` need unit tests with edge cases.
   - No `TODO` without a matching `docs/DEBT.md` entry.
   - PRD status and evidence updated for the requirement.
   - A `docs/STATUS.md` entry with what changed, what is next and anything another agent must know.
4. **No silent stubs.** If you must stub something another agent owns, put it in `packages/testing/fakes`, name it `Fake<Thing>`, and log it in `docs/DEBT.md` with the gate by which it must be replaced.
5. **Feature flags** for anything not yet ready for real users (`flags.ts` in `packages/core`, read from env).
6. **Secrets** only from environment variables. Never commit keys. `.env.example` lists every variable with a comment.
7. **Idempotency.** Every webhook handler, payment, payout and job step must be safe to run twice. Use idempotency keys and unique constraints.
8. **Money is integers.** Store cents as integers. Never floats for money.
9. **Time is UTC.** Store `timestamptz`, render in the viewer's time zone.
10. **PII boundary.** Researcher-facing code never imports from `packages/db/src/pii`. A lint rule enforces this (Agent 1 sets it up at Gate 0).
11. **Copy.** User-facing strings live in `copy.ts` files per area, sentence case, no em dashes, matching the design system voice. This makes the possible rename a one-file change.

## 6. Stage gates

Work proceeds in five gates. **At each gate, all feature work stops until the gate's integration suite is green and its debt review is done.** Agent 1 runs the gate. After every exit criterion has evidence in `docs/STATUS.md`, Codex may record "Gate N passed" there under Rachel’s delegated sign-off. Share the gate result with Rachel and then start the next gate. See `docs/KICKOFF.md` for how the agents are started and supervised.

### Where to see each journey

The [PRD user journeys](PRD.md#6-user-journeys) describe the two paths in full. The [design system](design-system/README.md) includes the interaction specs and component previews. Use the table below to find the running screens or the gate that builds them.

| Gate | Respondent UI | Researcher UI |
| --- | --- | --- |
| 0 · Running preview | [Welcome](https://envoilabs-git-preview-gate-0-rachelgonsalves821s-projects.vercel.app/r) and [email signup and sign-in](https://envoilabs-git-preview-gate-0-rachelgonsalves821s-projects.vercel.app/r/signup) with age attestation and respondent account provisioning. | [Email sign-in](https://envoilabs-git-preview-gate-0-rachelgonsalves821s-projects.vercel.app/app/sign-in), authenticator setup after a validated link, and a [protected workspace](https://envoilabs-git-preview-gate-0-rachelgonsalves821s-projects.vercel.app/app) with placeholder scoping and brief content. |
| 1 · Seeded study preview | [Respondent Home](https://envoilabs-git-preview-gate-0-rachelgonsalves821s-projects.vercel.app/r) opens eligible invites and in-progress studies after sign-in. [Profile and privacy choices](https://envoilabs-git-preview-gate-0-rachelgonsalves821s-projects.vercel.app/r/onboarding) precede the interview, which supports recording, typing, retry, resume and submission. | [Researcher workspace](https://envoilabs-git-preview-gate-0-rachelgonsalves821s-projects.vercel.app/app) opens the four-question study form after email and MFA. Launch a test study to reach live tracking and the redacted transcript panel. |
| 2 · First real study | Open self-service profile and matching, confirming screener, interview follow-ups, receipt, and Earnings with prepaid Visa payout status and history. | Scoping chat beside the live brief, review of screening criteria and guide, $2-per-question quote, checkout, and live tracking. |
| 3 · Pilot | Liveness, full Echo states, privacy and withdrawal controls. | Report and findings, verified quotes, hypothesis evidence and next-study proposal. |
| 4 · Launch | Accessible and resilient interview on mobile. | Export and launch hardening. |

Record browser evidence against the paths for the applicable gate. Include the successful path and visible states for waiting, retry, disqualification or expiry where they apply, plus phone keyboard and reduced-motion checks.

### Gate 0. Foundations (end of week 1)

Exit criteria
- [x] Monorepo builds, CI runs typecheck, lint, unit tests, integration tests and Playwright on every PR in under 12 minutes
- [x] Supabase local runs in CI. Migrations apply from zero. Seed script creates 1 organization, 2 researchers, 60 respondents with varied profiles and 1 draft study
- [x] `packages/contracts` v1 published with schemas for every entity, every API request and response in Gate 1 scope, every event in PRD section 12, `BriefPatch`, `ProbeDecision`, `ThemeSet`
- [x] RLS policies on every table, with tests that a respondent cannot read another respondent's data and a researcher cannot read PII
- [x] Auth works for both user types locally and on the dedicated hosted preview. Use the [hosted sign-in procedure](../README.md#verify-sign-in-on-the-hosted-preview). Record the deployment commit and both outcomes before sign-off. Platform owns execution and tracks preview access and controlled test identities on [goal #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4).
- [x] `packages/ui` exports tokens (CSS variables generated from the design system `tokens.json`), Button, Chip, EarningsChip, and an Echo stub that renders the static fallback
- [x] `packages/ai` exposes provider interfaces with fake implementations, plus a recorded-fixture mode for tests
- [x] Fakes for Stripe, Tremendous, LLM and transcription in `packages/testing/fakes`. Disposable Auth email is delivered to Mailpit in CI.
- [x] Lint rules for the PII boundary, no `any`, no floats for money (named `cents` fields), and no cross-agent imports into app route folders

Gate 0 has delegated sign-off. The record links the CI checks, contracts distribution, database coverage and both hosted sign-ins. [Gate 0 evidence](STATUS.md#gate-checklist-tracker)

Use merged CI and the existing auth, database, contract, UI and AI foundations as the starting point. In the gate evidence, link the local checks and mark hosted checks separately. Confirm coverage against each criterion, including any gap in the access matrix or eval harness. While preview access is pending, complete Gate 0 evidence and prepare Gate 1 contract and acceptance scenarios. See the [Gate 1 handoff](GATE_1_HANDOFF.md) for ownership, merge order and test coverage.

Integration tests required
- `IT-0.1` migrations up from zero, and seed is idempotent
- `IT-0.2` RLS matrix (respondent, researcher, admin, anon) against every table
- `IT-0.3` contract round trip, every Zod schema parses its own example fixture

### Gate 1. Vertical slice (end of week 3)

One study runs end to end with seeded data and fakes for paid vendors. The checked items have evidence from the disposable study and database tests. Follow the [current status](STATUS.md#gate-checklist-tracker) for hosted acceptance, live transcription and redaction qualification.

Exit criteria
- [x] Researcher can create a study from a minimal form (scoping chat not required yet), add 4 core guide questions (the PRD billing minimum) and launch without payment (flagged `skip_payment` in non-prod)
- [x] Matching selects eligible seeded respondents, creates invites and respects caps
- [x] Respondent signs up via a one-time email link (Mailpit in CI), completes profile and consent, and sees their own eligible invite on signed-in Home. They accept, record 4 answers in the browser, and submit. Return sign-in restores the same account, study access and saved progress.
- [x] Consented voice answers upload privately and a job calls the primary speech-to-text adapter with a bounded fallback. Record provider, model, latency and cost. Confirm a real-provider run on synthetic browser recordings and keep CI deterministic. Typed answers reach the same redaction path.
- [x] Session moves `started` to `submitted` to `quality_hold`
- [ ] Researcher tracking shows live counts and only redacted transcripts. Record the Presidio benchmark and adoption decision before publication.
- [x] Record the OpenInterviewer review before the Gate 2 probe work. See section 11 for the upstream checks.
- [x] State machine transitions are audited

Integration tests required
- `IT-1.1` Playwright E2E `gate1-slice.spec.ts`, desktop researcher and mobile respondent, full flow above. Verify Home shows the respondent's eligible invites and excludes another respondent's invites. Return sign-in must open the same account.
- `IT-1.2` transcription pipeline with five synthetic recordings under `packages/testing/fixtures/audio`, including browser-compatible formats. Verify primary success, timeout and fallback, consent denial, provider metadata, typed answers bypassing speech recognition, and publication only after redaction.
- `IT-1.3` session resume, kill the page mid-interview, reopen the resume link, land on the next unanswered question
- `IT-1.4` invite expiry job marks active sessions `abandoned` after 24h (time-travel via injectable clock)
- `IT-1.5` duplicate or concurrent launches, invite accepts and answer confirmations converge on one durable result. Simulate job dispatch failure after answer persistence and verify that retry delivers the event once logically. Assert that pending or failed redaction never publishes raw content.

Debt review. Every `Fake` used in the Gate 1 flow is listed in `DEBT.md` with the gate that replaces it.

### Gate 2. Money loop and scoping (end of week 5)

**2026-11-24 owner direction and implementation impact.** Open self-service signup/profile feeds eligibility and matching; there is no selected invite cohort or hand recruitment for the first real study. The table records the next required changes; draft PRs remain synthetic preparation until the revised economics and lifecycle pass together.

| Area | Required Gate 2 behavior | Existing preparation and gap |
| --- | --- | --- |
| Quote and checkout | Freeze 200 cents per core question per respondent, minimum 10 respondents, config version, scope and per-slot price. Probes/screeners are unbilled. | Existing versioned quote/test-mode checkout work assumes the old active config and must be migrated and retested before a new paid quote. Do not rewrite a paid quote. |
| Marketplace and feasibility | Accept self-service profiles, match eligible active respondents with caps/cooldowns, and estimate fill only from measurable active supply and historic rates. | Seeded invite selection is a fixture, not real open-marketplace feasibility. No promise of fill time without a defensible sample. |
| Respondent reward and payout | Reserve 100 cents for each answered core question under approved quality policy; prepaid Visa is the v1 product. Keep payout ledger separate from researcher charges/refunds. | Existing payout reservation/idempotency is a base; provider catalog, recipient routing, partial-answer eligibility and sandbox order need revision and evidence. |
| Unfilled refund | At the fill cutoff, refund each uncompleted respondent slot using the frozen quote's per-slot charge. One missing slot in a 12-slot quote refunds one slot, once. | Existing refund observations cover provider state, but not a completed-slot accounting/refund command. Add immutable count snapshot, idempotency and reconciliation. |
| Referral | Vest $5 once when five distinct referred friends have verified profiles. | Referral source fields alone are insufficient. Add unique attribution, verified-profile event, fraud exclusions and an idempotent bonus ledger. |

The owner still needs to define the fill cutoff, disputed or later-completed slot handling, verified-profile fraud review, partial-answer quality eligibility and prepaid Visa provider details. Keep live enrollment and money actions closed while these are unresolved. The missing voice consent/data handling document also keeps live voice and LLM follow-up dispatch disabled.

Exit criteria
- [ ] Scoping chat produces a complete brief through the real LLM with structured `BriefPatch` outputs, and the researcher approves the screening criteria and guide.
- [ ] A preliminary match can complete an LLM-assisted confirming screener (R-RESP-05, PRD 8.5). Respondents see the question, progress and a clear result. Platform applies documented qualification rules after Agent 3 validates the model output and evidence. Before any screening model call, Platform must supply a current study/answer/provider-purpose authorization for the full typed or transcribed screener answer; fail closed without a distinct approved `screening_model` receipt. `ai_followup` consent does not cover screening. Live model input remains disabled pending Rachel/counsel-approved copy and enforcement tests. Consent-gated voice answers use the Gate 1 speech-to-text path.
- [ ] Quote computed by `packages/core` pricing at the active versioned $2 unit price, at least 10 respondents, and feasibility from actual active marketplace matching data; never promise a fill time without evidence
- [ ] Stripe Checkout in test mode, webhook launches the study, and an idempotent pro-rata refund path for uncompleted respondent slots using the original frozen quote price per slot. A 12-slot study with 11 completes refunds one slot.
- [ ] Web push invites and halfway and 2-hours-left nudges
- [ ] Quality hold job approves or removes sessions using the v1 quality score, and removed sessions trigger replacement invites
- [ ] Sandbox prepaid Visa payout after approval, idempotent, with annual cap enforced. Verify the provider's exact Visa product, recipient delivery, fees and status mapping. Respondent Earnings shows their own payout status and history.
- [ ] Points ledger, milestone bonuses and receipt UI
- [ ] **First real study** uses open self-service respondent signup/profile and approved marketplace matching, with at least 10 target respondents and Rachel as researcher. No hand-picked cohort or recruiting contact is part of this plan. Complete the pre-study checklist below before live enrollment.

Integration tests required
- `IT-2.1` Playwright `gate2-money.spec.ts`, open signup/profile to eligible matching and scoping (LLM in fixture-replay mode) to a 10-respondent-minimum quote to Stripe test checkout to launch to synthetic completes, approval and sandbox prepaid Visa order. Verify payout status and history in the respondent account
- `IT-2.2` webhook idempotency, replay every Stripe and Tremendous webhook 3 times, assert one effect
- `IT-2.3` pricing tests, price equals core questions × respondents × 200 cents in integer cents, probes and screeners never billed, 5 questions × 10 respondents = 10000 cents, fewer than 10 rejected, config version stored on every quote
- `IT-2.4` quality removal triggers replacement invite, and target completes still reached
- `IT-2.5` payout cap, a respondent at $1,990 YTD cannot receive a $20 payout and is flagged
- `IT-2.6` push delivery contract, the nudge job enqueues correct payloads at the right times (injectable clock)
- `IT-2.7` complete the screening sheet through eligibility and invite state for an open self-service profile. Cover typed and transcribed answers, supported and contradicted evidence, ambiguity, invalid and timed-out responses, consent, repeated delivery, and an existing participation cap. Add five distinct verified referred profiles, self-referral/duplicate rejection and exact-replay tests before the $5 bonus can vest.
- `IT-2.8` freeze a 12-respondent quote and complete 11 synthetic slots; reconcile exactly one refund at the original per-slot price under repeated webhook/job delivery. A changed active price version must not alter the refund. Keep the 11 respondents' per-answered-question reward reservations independent of the researcher refund. Reject a second refund for the same missing slot.

**Pre-study checklist.** Platform records the approved open-marketplace eligibility and matching policy, verified-profile referral event, consent text version and allowed processing, provider data handling and preview isolation. Apply PRD Q-04 through Q-06, Q-08, Q-10 and Q-11 before live enrollment. Use synthetic participants while those details are pending. Verify Auth email delivery with a dedicated sender to a controlled external test inbox before opening signup to real respondents. Exercise consent enforcement, withdrawal and deletion through storage, queues and derived data, and verify that researcher endpoints and exports only publish redacted artifacts. Keep raw voice sharing off for this first study. Exercise recording and retry on physical iOS Safari and Android Chrome, verify speech-to-text and the probe display, and verify the screener clarification and timeout paths on approved test inputs before participants enter a paid study. Confirm the $1-per-answered-core-question payout, pro-rata frozen-quote refund and prepaid Visa provider fees before any real monetary commitment. Record actual results separately from sandbox evidence.

Debt review plus a **contract freeze check**. List every breaking contract change since Gate 0 and confirm old versions are removed or dated.

### Gate 3. Probing, reports and pilot (end of week 7)

Exit criteria
- [ ] Live probes show in under 6 seconds p95 from upload confirmation to browser render. Time the full path on representative mobile recordings and devices. Report sample size, p95 for rendered probes and separate counts/rates for intentional no-probe decisions, errors and timeouts. Agree on an acceptable timeout rate before fielding. A late result cannot replace the next question.
- [ ] Analyst report with themes, counts, confidence, verified quotes, hypothesis scores and next-study proposal
- [ ] Redaction eval passes thresholds (section 7)
- [ ] Fraud controls (verified email uniqueness, device and recipient caps, duplicate audio hash, speed) and liveness phrase live
- [ ] Privacy controls (delete, export, withdraw, voice sharing toggle) and the retention job
- [ ] Echo in full WebGL with all states, reduced-motion and no-WebGL fallbacks
- [ ] Accessibility pass with axe on all main screens, zero serious or critical issues
- [ ] Pilot with 30 to 50 respondents and 2 to 3 founders completed, and metrics from PRD section 12 recorded in `STATUS.md`

Integration tests required
- `IT-3.1` Playwright `gate3-full.spec.ts`, full journey including probes and report, with LLM in fixture-replay mode
- `IT-3.2` report evidence integrity. Every quote resolves to an exact span in the redacted transcript version for that study. Withdrawal, deletion and re-redaction invalidate affected evidence in reports and exports.
- `IT-3.3` PII leak test. Exercise cross-tenant and pre-MFA access, private media links, exports, researcher APIs and report content. Include names, phones, emails, addresses and employers, and verify that redaction failures withhold publication.
- `IT-3.4` deletion request removes respondent PII, audio and transcripts, and keeps anonymized aggregates
- `IT-3.5` load test with k6, 200 concurrent respondents uploading answers, p95 upload under 2 s and no job backlog over 60 s

### Gate 4. Launch hardening (end of week 8)

Exit criteria
- [ ] Security review (OWASP top 10 checklist, dependency audit, RLS re-test, rate limits on email sign-in and uploads)
- [ ] Performance budgets, respondent interview screen LCP under 2.5 s on a mid-range phone profile, JS under 200 KB gzipped excluding the Echo chunk, which lazy-loads
- [ ] Runbooks in `docs/runbooks/` for failed payouts, stuck jobs, LLM outage (fallback to static guide with no probes), and Stripe disputes
- [ ] Debt sprint, every `DEBT.md` item tagged `gate4` closed or explicitly accepted by Rachel
- [ ] PRD fully updated, every requirement `Done`, `Cut` or `Needs decision`, with evidence

Integration tests required
- `IT-4.1` the full suite green three runs in a row (flake check)
- `IT-4.2` chaos tests, LLM provider returns errors (interview continues without probes), transcription fails (retry then fallback provider), Tremendous down (payout stays `pending` and retries)

## 7. AI evals (Agent 3 owns, run in CI)

Evals live in `packages/ai/evals`. Each has a fixture set and pass thresholds. Run deterministic fixtures on each PR touching AI, contracts or publication logic. The current replay baseline checks fixtures and plumbing. Before enabling live behavior, Agent 3 records prompt and model versions, fixture denominators and scored held-out outputs. Run a credentialed, budget-capped live check on synthetic or approved test data in a trusted environment, with tracked failures and a rollback version. Report redaction recall by entity and false positives that remove useful evidence.

| Eval | Fixture set | Pass threshold |
| --- | --- | --- |
| Scoping completeness | 25 scripted founder conversations | 90%+ produce a valid complete `Brief`, 0 prices in agent text |
| Sizing pushback | 10 sizing goals | 100% push back |
| Guide quality | 25 briefs | 0 leading questions by rubric judge, 6 to 8 questions each |
| Confirming screener | Labeled typed answers and equivalent synthetic audio, with clear, contradictory, ambiguous and invalid cases | Record decision agreement and exclusion errors on held-out fixtures. All unsupported, invalid and timed-out decisions must take the clarification or review path. Set the acceptable exclusion error budget before live use. |
| Probe quality | 60 answer transcripts | 90%+ probes judged non-leading and on-goal, 0 off-topic answers |
| Redaction | 100 synthetic transcripts with planted PII | Recall 99%+ for phones and emails, 95%+ for names and employers |
| Analyst evidence | 10 studies of fixture transcripts | 100% quotes verified, theme counts within ±1 of hand labels |

## 8. Keeping technical debt low

- **One source of truth per concept.** Schema in `packages/db`, shapes in `packages/contracts`, rules in `packages/core`, prompts in `packages/ai/prompts`. Never duplicate a type.
- **Thin route handlers.** Route handlers validate input with contracts, call a `packages/services` function (or `packages/ai` for AI-only calls), return. No business logic in `apps/web`.
- **Pure core, thin services.** `packages/core` has no I/O. `packages/services` does the I/O and calls core. Clock, random and IDs are injected. This keeps logic unit-testable and lets tests time-travel.
- **Provider interfaces** for every vendor (LLM, transcription, payouts, payments, push). Fakes in `packages/testing`.
- **ADRs.** Any decision that changes the stack, a boundary or a contract gets a one-page ADR in `docs/adr/NNNN-title.md`.
- **Debt register.** `docs/DEBT.md` columns are ID, description, owner, created, must-fix-by gate, status. Each gate review closes or re-dates items. Debt with no gate is not allowed.
- **Debt budget.** About 20% of each week after Gate 1 goes to debt items tagged for the next gate.
- **Generated code** (DB types, token CSS) is regenerated in CI and diffed. A stale generated file fails CI.
- **Dependency hygiene.** Pin versions, Renovate weekly, no new dependency without a line in the PR description saying why.

## 9. Coordination

- **STATUS.md** is the shared channel. Every session ends with an entry using this template.

```
## YYYY-MM-DD HH:MM, Agent N
Done: <PR links and requirement IDs>
Next: <what you will do next>
Needs from others: <issue links or "none">
Contract or schema changes: <list or "none">
Risks: <anything that might slip a gate>
```

- **Blocked work.** If blocked by another agent for more than one session, use a fake, log the debt, and keep going on something else in your area.
- **Merge order on conflicts.** Agent 1 merges contract and migration PRs first each day. Others rebase after.
- **Record decisions** that affect PRD section 5, money, privacy, or user-facing claims and tag the relevant PR. Use the delegated review process. Escalate unresolved questions and actions that require Rachel’s direct access or participation.

## 10. Week by week

| Week | Agent 1 Platform | Agent 2 Respondent | Agent 3 Researcher and AI |
| --- | --- | --- | --- |
| 1 | Repo, CI, Supabase, schema v1, RLS, contracts v1, fakes, seed, lint rules | `packages/ui` tokens and base components, respondent shell, email signup and sign-in | `packages/ai` interfaces and fakes, prompt file structure, eval harness, researcher shell |
| 2 | State machines, matching, invites, session APIs, audit log | Profile, consent, invite card, interview screen with recording | Minimal study form, guide editor, transcription pipeline |
| 3 | Gate 1 integration suite, expiry job | Upload and resume, receipt stub | Redaction v1, tracking page |
| 4 | Revised pricing, Stripe, quality v1, prepaid Visa sandbox, screening and referral rules | Confirming screener, push subscription, nudges and prepaid Visa status | Scoping, screening interpretation and evals, live brief, quote and checkout |
| 5 | Gate 2 suite, points ledger, replacement invites, pre-study privacy and compensation checks | Points and receipt, probe display, physical-device checks | Interviewer probe agent v1, first real study support |
| 6 | Fraud controls, liveness check, retention job, admin console | Full Echo (WebGL states), probe display, privacy controls | Analyst agent, report UI, evidence verification |
| 7 | Gate 3 suite, load test, pilot ops | Accessibility pass, pilot fixes | Evals to threshold, next-study proposal, pilot fixes |
| 8 | Gate 4 security, chaos tests, runbooks | Performance budget, polish | Export, copy review, polish |

## 11. Open-source evaluation and reuse

| Candidate | Owner and timing | Decision to record |
| --- | --- | --- |
| [Presidio](https://github.com/data-privacy-stack/presidio) | Agents 1 and 3, Gate 1 before researcher transcript publication | Benchmark the analyzer/anonymizer as the deterministic first pass against labeled text. Pin the source revision and image, choose a private deployment for preview and production, and verify failure keeps raw text private. Run an approved contextual pass for missed names, employers and schools. Document an alternative in an ADR if Presidio fails acceptance. |
| [OpenInterviewer](https://github.com/linxule/openinterviewer) | Agent 3, review in Gate 1, adapt accepted patterns in Gates 2–3 | In the ADR, pin the commit and map the reviewed probe loop, synthesis and follow-up patterns to Envoi contracts, latency and consent. List what is reused or skipped. Exercise any adopted behavior in probe or report tests. |
| [OpenVerbatim](https://github.com/Vellum-Works/openverbatim) | Agent 3, Gate 3 before report implementation | Record the pinned revision and adapt the evidence-location pattern. Validate the quote against the exact version of the redacted source, suppress invalid evidence, and submit IT-3.2 results. |

For each proposal, verify the license at the pinned revision and for the files used. If shipping third-party code or images, preserve applicable license, copyright and NOTICE material, record modifications where required, and update [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) in the same PR. Add tests and record the reuse decision in STATUS. Ask Rachel to resolve unclear licensing before adopting code. Keep matching, quality decisions, pricing, points and payout policy in Envoi Labs.

## 12. Implementation rules for cross-agent boundaries

- **Platform and both UIs, Gate 1.** Use scoped answer IDs and separate upload authorization from answer confirmation. Confirm ownership, object metadata and consent server-side. Persist answer confirmation and a durable record for job delivery together. Keep job retries, re-records and repeated confirmations from creating duplicate answers. Resolve resume against persisted state and current authorization.
- **Platform and AI, Gate 1.** Require tenant or respondent scope in queries, private storage, limited worker privileges and a separate redacted publication path. Suppress raw payloads in telemetry, CI fixtures, structured logs and researcher access. Check current consent before external processing and again before publication. A pending deletion or revoked permission must prevent a delayed job from republishing the data.
- **Platform, Gate 2.** Exercise duplicate, concurrent and out-of-order payment and payout events. Confirm provider payment state, quote, currency and amount before launch. Reserve payout capacity transactionally across pending and delivered orders. Reconcile unclear provider outcomes before retrying, and keep money movement and refund evidence tied to immutable records.
- **Platform, Gate 2 economics.** Track realized revenue net of refunds and include incentives, reward and payment fees, recruiting, replacements, transcription and LLM spend per approved complete. Record pilot assumptions and observed values separately. Keep the $2 researcher price, $1 answered-core-question reward, minimum 10, verified-profile referral and frozen-slot refund decisions in the PRD. Treat [proposed terms v0.2](terms-draft-v0.2.md) as an unapproved review draft; verify consent, retention, fees and provider claims before live use.
- **All agents.** Keep fixture audio and transcripts synthetic or specifically approved for repository distribution. Preserve the typed-answer path, including microphone denial. Bring any change to mandatory voice liveness or consent eligibility to Rachel as a PRD decision before running the real study.
