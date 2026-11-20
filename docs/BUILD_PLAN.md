# Envoi Labs build plan

This plan tells three coding agents how to build v1 of Envoi Labs in 8 weeks without stepping on each other and without piling up technical debt. The PRD (`docs/PRD.md`) says what to build. This file says how, who and when.

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
| Auth | Supabase Auth. Phone OTP for respondents, email magic link plus TOTP MFA for researchers | Matches PRD |
| Payments | Stripe Checkout and webhooks | Researcher payment |
| Payouts | Tremendous API (sandbox first) | Gift cards, W-9 and 1099 handling |
| LLM | Anthropic Claude via `packages/ai` provider interface | Structured outputs, tool use |
| Transcription | OpenAI `gpt-4o-mini-transcribe`, Groq Whisper fallback, behind an interface | PRD 7.4 |
| Push | Web Push (VAPID) with `web-push` | PWA notifications |
| SMS | Twilio Verify for OTP only. SMS nudge behind a flag (PRD Q-02) | |
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
│  ├─ integrations/                  Stripe, Tremendous, Twilio, web push clients (Agent 1, push sender by Agent 2)
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
1. Write the proposed schema change in a PR touching only `packages/contracts`, titled `[CONTRACT] <name>`.
2. Include a short note in `docs/STATUS.md` naming who is affected.
3. Agent 1 merges after CI passes. Breaking changes need a version suffix (`AnswerUploadedV2`) and a removal date for the old one, logged in `docs/DEBT.md`.
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

Work proceeds in five gates. **At each gate, all feature work stops until the gate's integration suite is green and its debt review is done.** Agent 1 runs the gate. The gate passes when every exit criterion is checked in `docs/STATUS.md` with evidence links and Rachel replies "Gate N passed" there. See `docs/KICKOFF.md` for how the agents are started and supervised.

### Gate 0. Foundations (end of week 1)

Exit criteria
- [ ] Monorepo builds, CI runs typecheck, lint, unit tests, integration tests and Playwright on every PR in under 12 minutes
- [ ] Supabase local runs in CI. Migrations apply from zero. Seed script creates 1 organization, 2 researchers, 60 respondents with varied profiles and 1 draft study
- [ ] `packages/contracts` v1 published with schemas for every entity, every API request and response in Gate 1 scope, every event in PRD section 11, `BriefPatch`, `ProbeDecision`, `ThemeSet`
- [ ] RLS policies on every table, with tests that a respondent cannot read another respondent's data and a researcher cannot read PII
- [ ] Auth works for both user types in local and preview environments
- [ ] `packages/ui` exports tokens (CSS variables generated from the design system `tokens.json`), Button, Chip, EarningsChip, and an Echo stub that renders the static fallback
- [ ] `packages/ai` exposes provider interfaces with fake implementations, plus a recorded-fixture mode for tests
- [ ] Fakes for Stripe, Tremendous, Twilio, LLM and transcription in `packages/testing/fakes`
- [ ] Lint rules for the PII boundary, no `any`, no floats for money (named `cents` fields), and no cross-agent imports into app route folders

Integration tests required
- `IT-0.1` migrations up from zero, and seed is idempotent
- `IT-0.2` RLS matrix (respondent, researcher, admin, anon) against every table
- `IT-0.3` contract round trip, every Zod schema parses its own example fixture

### Gate 1. Vertical slice (end of week 3)

One study runs end to end with seeded data and fakes for paid vendors.

Exit criteria
- [ ] Researcher can create a study from a minimal form (scoping chat not required yet), add 3 guide questions and launch without payment (flagged `skip_payment` in non-prod)
- [ ] Matching selects eligible seeded respondents, creates invites and respects caps
- [ ] Respondent signs up by phone (Twilio fake in CI), completes profile and consent, sees the invite, accepts, records 3 answers in the browser, and submits
- [ ] Audio uploads to storage, transcription runs (real provider in a nightly job, fake in CI), transcripts stored with provider metadata
- [ ] Session moves `started` to `submitted` to `quality_hold`
- [ ] Researcher tracking page shows counts updating, and transcripts are visible redacted
- [ ] State machine transitions are audited

Integration tests required
- `IT-1.1` Playwright E2E `gate1-slice.spec.ts`, two browser contexts (desktop researcher and mobile respondent), full flow above
- `IT-1.2` transcription pipeline with fixture audio (5 real recordings committed under `packages/testing/fixtures/audio`), asserts transcript stored and redaction applied
- `IT-1.3` session resume, kill the page mid-interview, reopen the resume link, land on the next unanswered question
- `IT-1.4` invite expiry job marks sessions `abandoned` after 24h (time-travel via injectable clock)

Debt review. Every `Fake` used in the Gate 1 flow is listed in `DEBT.md` with the gate that replaces it.

### Gate 2. Money loop and scoping (end of week 5)

Exit criteria
- [ ] Scoping chat produces a complete brief through the real LLM with structured `BriefPatch` outputs, and the guide is drafted
- [ ] Quote computed by `packages/core` pricing with stored config version, and feasibility from matching
- [ ] Stripe Checkout in test mode, webhook launches the study, refund path for cancelled studies
- [ ] Web push invites and halfway and 2-hours-left nudges
- [ ] Quality hold job approves or removes sessions using the v1 quality score, and removed sessions trigger replacement invites
- [ ] Tremendous sandbox gift card payout after approval, idempotent, with annual cap enforced
- [ ] Points ledger, milestone bonuses and receipt UI
- [ ] **First real study** run on preview with hand-recruited respondents (at least 10 completes) and Rachel as researcher

Integration tests required
- `IT-2.1` Playwright `gate2-money.spec.ts`, scoping (LLM in fixture-replay mode) to quote to Stripe test checkout to launch to 3 completes to approval to Tremendous sandbox order
- `IT-2.2` webhook idempotency, replay every Stripe and Tremendous webhook 3 times, assert one effect
- `IT-2.3` pricing tests, price equals core questions × respondents × unit price in integer cents, probes and screeners never billed, 5 questions × 1 respondent = 500 cents, config version stored on every quote
- `IT-2.4` quality removal triggers replacement invite, and target completes still reached
- `IT-2.5` payout cap, a respondent at $1,990 YTD cannot receive a $20 payout and is flagged
- `IT-2.6` push delivery contract, the nudge job enqueues correct payloads at the right times (injectable clock)

Debt review plus a **contract freeze check**. List every breaking contract change since Gate 0 and confirm old versions are removed or dated.

### Gate 3. Probing, reports and pilot (end of week 7)

Exit criteria
- [ ] Live interviewer probes in production path, p95 under 6 seconds measured in the `llm_call` and `probe.shown` data
- [ ] Analyst report with themes, counts, confidence, verified quotes, hypothesis scores and next-study proposal
- [ ] Redaction eval passes thresholds (section 7)
- [ ] Fraud controls (phone, device, recipient caps, duplicate audio hash, speed) and liveness phrase live
- [ ] Privacy controls (delete, export, withdraw, voice sharing toggle) and the retention job
- [ ] Echo in full WebGL with all states, reduced-motion and no-WebGL fallbacks
- [ ] Accessibility pass with axe on all main screens, zero serious or critical issues
- [ ] Pilot with 30 to 50 respondents and 2 to 3 founders completed, and metrics from PRD section 11 recorded in `STATUS.md`

Integration tests required
- `IT-3.1` Playwright `gate3-full.spec.ts`, full journey including probes and report, with LLM in fixture-replay mode
- `IT-3.2` report evidence integrity, every quote in a generated report matches a transcript span exactly
- `IT-3.3` PII leak test, scan every researcher API response in the E2E run for seeded PII strings (names, phones, emails) and fail on any match
- `IT-3.4` deletion request removes respondent PII, audio and transcripts, and keeps anonymized aggregates
- `IT-3.5` load test with k6, 200 concurrent respondents uploading answers, p95 upload under 2 s and no job backlog over 60 s

### Gate 4. Launch hardening (end of week 8)

Exit criteria
- [ ] Security review (OWASP top 10 checklist, dependency audit, RLS re-test, rate limits on OTP and uploads)
- [ ] Performance budgets, respondent interview screen LCP under 2.5 s on a mid-range phone profile, JS under 200 KB gzipped excluding the Echo chunk, which lazy-loads
- [ ] Runbooks in `docs/runbooks/` for failed payouts, stuck jobs, LLM outage (fallback to static guide with no probes), and Stripe disputes
- [ ] Debt sprint, every `DEBT.md` item tagged `gate4` closed or explicitly accepted by Rachel
- [ ] PRD fully updated, every requirement `Done`, `Cut` or `Needs decision`, with evidence

Integration tests required
- `IT-4.1` the full suite green three runs in a row (flake check)
- `IT-4.2` chaos tests, LLM provider returns errors (interview continues without probes), transcription fails (retry then fallback provider), Tremendous down (payout stays `pending` and retries)

## 7. AI evals (Agent 3 owns, run in CI)

Evals live in `packages/ai/evals`. Each has a fixture set and pass thresholds. CI runs them in replay mode on every PR touching `packages/ai`, and against the live model nightly.

| Eval | Fixture set | Pass threshold |
| --- | --- | --- |
| Scoping completeness | 25 scripted founder conversations | 90%+ produce a valid complete `Brief`, 0 prices in agent text |
| Sizing pushback | 10 sizing goals | 100% push back |
| Guide quality | 25 briefs | 0 leading questions by rubric judge, 6 to 8 questions each |
| Probe quality | 60 answer transcripts | 90%+ probes judged non-leading and on-goal, 0 off-topic answers |
| Redaction | 100 synthetic transcripts with planted PII | Recall 99%+ for phones and emails, 95%+ for names and employers |
| Analyst evidence | 10 studies of fixture transcripts | 100% quotes verified, theme counts within ±1 of hand labels |

## 8. Keeping technical debt low

- **One source of truth per concept.** Schema in `packages/db`, shapes in `packages/contracts`, rules in `packages/core`, prompts in `packages/ai/prompts`. Never duplicate a type.
- **Thin route handlers.** Route handlers validate input with contracts, call a `packages/services` function (or `packages/ai` for AI-only calls), return. No business logic in `apps/web`.
- **Pure core, thin services.** `packages/core` has no I/O. `packages/services` does the I/O and calls core. Clock, random and IDs are injected. This keeps logic unit-testable and lets tests time-travel.
- **Provider interfaces** for every vendor (LLM, transcription, payouts, payments, SMS, push). Fakes in `packages/testing`.
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
- **Escalate to Rachel** for anything in PRD section 5 (decided), anything touching money amounts, privacy promises or user-facing claims, and any requirement marked `Needs decision`.

## 10. Week by week

| Week | Agent 1 Platform | Agent 2 Respondent | Agent 3 Researcher and AI |
| --- | --- | --- | --- |
| 1 | Repo, CI, Supabase, schema v1, RLS, contracts v1, fakes, seed, lint rules | `packages/ui` tokens and base components, respondent shell, phone auth screens | `packages/ai` interfaces and fakes, prompt file structure, eval harness, researcher shell |
| 2 | State machines, matching, invites, session APIs, audit log | Profile, consent, invite card, interview screen with recording | Minimal study form, guide editor, transcription pipeline |
| 3 | Gate 1 integration suite, expiry job | Upload and resume, receipt stub | Redaction v1, tracking page |
| 4 | Pricing, Stripe, quality v1, payouts with Tremendous sandbox | Push subscription and nudges, gift card choice | Scoping agent and live brief, quote UI, checkout UI |
| 5 | Gate 2 suite, points ledger, replacement invites, first real study support | Points and receipt, iPhone install guide | Interviewer probe agent v1, first real study support |
| 6 | Fraud controls, liveness check, retention job, admin console | Full Echo (WebGL states), probe display, privacy controls | Analyst agent, report UI, evidence verification |
| 7 | Gate 3 suite, load test, pilot ops | Accessibility pass, pilot fixes | Evals to threshold, next-study proposal, pilot fixes |
| 8 | Gate 4 security, chaos tests, runbooks | Performance budget, polish | Export, copy review, polish |
