# Agent 1 brief. Platform

You build the foundation everything else stands on, and you run the stage gates. When you do your job well, Agents 2 and 3 never wait on you and never write business logic.

## You own
- Repo setup, Turborepo, CI (`.github/workflows`), lint rules, `AGENTS.md`, `docs/BUILD_PLAN.md`
- `packages/contracts`, `packages/db`, `packages/core` (pure logic, no I/O), `packages/services` (orchestration with I/O), `packages/integrations` (except the push sender), `packages/testing`
- `apps/web/app/admin`, `apps/web/app/api/webhooks`, `apps/web/inngest/platform`
- The Playwright harness in `apps/web/e2e` and every `IT-*` gate test unless the build plan names another owner

## You provide to others
| Consumer | What | By |
| --- | --- | --- |
| Agents 2 and 3 | Contracts v1, typed DB queries, auth helpers `getRespondent()` and `getResearcher()` | Gate 0 |
| Agents 2 and 3 | Fakes for Stripe, Tremendous, Twilio, LLM, transcription | Gate 0 |
| Agent 2 | Session and answer services in `packages/services` (`startSession`, `recordAnswer`, `submitSession`, `resumeSession`) | Week 2 |
| Agent 3 | Study lifecycle services in `packages/services` (`createStudy`, `updateBrief`, `quoteStudy`, `launchStudy`) and the `study.*` event stream | Week 2 and 4 |
| Agent 3 | Quality scoring hook so the AI quality signals feed `packages/core/quality` | Week 4 |

## Gate 0 tasks (week 1) → foundations for every requirement, R-RSCH-01 and R-RESP-01 auth backend

1. **Monorepo.** pnpm workspaces, Turborepo pipelines `build`, `typecheck`, `lint`, `test`, `test:integration`, `e2e`. TypeScript project references. Shared `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
2. **Lint rules.** ESLint with `@typescript-eslint/no-explicit-any` as error, `no-restricted-imports` blocking `packages/db/src/pii` from anything under `app/(researcher)`, `app/api/researcher`, `packages/ai`, and blocking imports across `app/(respondent)` and `app/(researcher)`. A custom rule or naming convention that money fields end in `Cents` and are integers.
3. **CI.** On every PR run typecheck, lint, unit, integration (Supabase local in Docker), Playwright (desktop Chrome and mobile Safari emulation), and generated-file drift check. Cache with Turborepo. Target under 12 minutes.
4. **Database schema v1** in `packages/db/migrations`. At minimum the tables below. Use `uuid` primary keys, `created_at` and `updated_at`, soft-delete only where stated.

| Table | Key columns |
| --- | --- |
| `organizations` | name, design_partner boolean, pricing_override_id |
| `researchers` | auth_user_id, organization_id, role (`member`, `admin`), terms_version |
| `respondents` | auth_user_id, status (`active`, `paused`, `banned`, `deleted`), quality_level, ytd_payout_cents, referral_code, whatsapp_waitlist_at |
| `pii.respondent_pii` | respondent_id, phone_e164 encrypted, phone_hash, birth_year, device_fingerprints |
| `profile_attributes` | respondent_id, key, value_json, source (`signup`, `screener`), updated_at |
| `consents` | respondent_id, purpose (`recording`, `transcription_vendor`, `retention`, `researcher_access`, `voice_clip_sharing`), granted, text_version, study_id nullable |
| `studies` | organization_id, title, state, target_completes, length_minutes, deadline_at, labels jsonb |
| `brief_versions` | study_id, version, brief_json (validated by `Brief` contract), created_by |
| `criteria` | study_id, kind (`must`, `nice`, `exclude`), attribute_key, operator, value_json, text |
| `guide_questions` | study_id, position, text, max_probes default 2 |
| `pricing_configs` | version, params_json, active boolean |
| `quotes` | study_id, pricing_config_version, line_items_json, total_cents, incentive_cents_per_complete, feasibility_json |
| `payments` | study_id, stripe_checkout_id unique, status, amount_cents, refunded_cents |
| `invites` | study_id, respondent_id, state, reward_cents, expires_at, why_you_text, unique (study_id, respondent_id) |
| `screener_answers` | invite_id, key, value_json |
| `sessions` | invite_id unique, state, started_at, submitted_at, liveness_phrase, liveness_passed |
| `answers` | session_id, guide_question_id, probe_id nullable, kind (`voice`, `text`), audio_object_id, duration_ms, sequence |
| `audio_objects` | storage_path, sha256, bytes, mime, delete_after |
| `transcripts` | answer_id unique, raw_text (PII schema or encrypted), redacted_text, provider, model, latency_ms, cost_micros |
| `probes` | answer_id, text, decided_at, shown_at, latency_ms |
| `quality_scores` | session_id unique, score, components_json, decision (`approve`, `remove`, `review`), decided_by |
| `removals` | session_id, reason, replacement_invite_id |
| `payouts` | session_id or bonus ref, respondent_id, amount_cents, state, tremendous_order_id, idempotency_key unique |
| `points_entries` | respondent_id, delta, reason, ref_id, unique (reason, ref_id) |
| `referrals` | referrer_id, referee_id, state, bonus_payout_id |
| `reports` | study_id, version, state, summary_json |
| `findings` | report_id, position, claim, count, total, confidence |
| `evidence_quotes` | finding_id, transcript_id, start_char, end_char, text |
| `push_subscriptions` | respondent_id, endpoint, keys_json, platform |
| `llm_calls` | purpose, model, input_tokens, output_tokens, latency_ms, cost_micros, study_id, ok |
| `audit_log` | entity, entity_id, from_state, to_state, actor, at, meta |
| `events` | name, actor_type, actor_hash, study_id, props, occurred_at |

5. **RLS** on every table. Respondents see only their own rows. Researchers see rows for their organization through views that exclude PII. The `pii` schema is reachable only by service role functions. Write `IT-0.2` as a matrix test.
6. **Contracts v1** in `packages/contracts`. Zod schemas and inferred types for every entity above (public shape), every API in Gate 1 scope, every event in PRD section 11, plus `Brief`, `BriefPatch`, `GuideDraft`, `ProbeDecision`, `ThemeSet`, `QualitySignals`. Each schema exports an `example` fixture used by `IT-0.3`.
7. **Auth.** Supabase phone OTP for respondents (Twilio Verify), magic link plus TOTP for researchers. Server helpers `requireRespondent()`, `requireResearcher()`, `requireAdmin()`.
8. **Fakes and fixtures** in `packages/testing`. `FakeStripe`, `FakeTremendous`, `FakeTwilio`, `FakeLLM` (scripted and fixture-replay modes), `FakeTranscriber` (returns fixture text keyed by audio hash). Factories for every entity. A `TestClock`.
9. **Seed** of 1 organization, 2 researchers, 60 respondents (mix of students and non-students, ages 18 to 45, on and off campus, varied food-ordering habits) and 1 draft study.

## Gate 1 tasks (weeks 2 to 3) → R-PLAT-02, R-PLAT-03, R-PLAT-11

1. **State machines** in `packages/core/state`. One module per entity (study, invite, session, payout) with an explicit transition table, guard functions and a pure `transition(entity, event, ctx)` that throws on illegal moves and returns the new state plus an audit entry. `packages/services/applyTransition` persists both in one DB transaction. 100% branch coverage on the pure module.
2. **Matching** in `packages/core/matching`.
   - `buildEligibilityFilter(criteria)` in core turns criteria into a typed filter. `packages/services/matching.findEligible` executes it through `packages/db`.
   - Excludes respondents with an active invite, more than 3 completes in the last 7 days, a completed study in the same topic category in the last 30 days, or status other than `active`.
   - `estimateFeasibility(study)` uses eligible count × historical accept rate × completion rate (default 15% and 70% until there is data) and returns expected completes by 24h and 48h.
   - `createInvites(study, n)` over-invites by `ceil(target / (accept × completion))`, in waves of 25% every 2 hours until filled.
3. **Session services** for Agent 2 in `packages/services/session`. `startSession`, `recordAnswer` (stores answer, enqueues transcription event `answer.uploaded`), `submitSession`, `resumeSession(token)` returning the next unanswered question. Signed resume tokens valid until expiry.
4. **Jobs** in `apps/web/inngest/platform`. `invite.waves`, `invite.expire` (24h), `session.abandon`, `study.check_complete`.
5. **Gate 1 suite** `IT-1.1` to `IT-1.4`. Coordinate with Agents 2 and 3 on selectors (use `data-testid` names agreed in `packages/contracts/testids.ts`).

## Gate 2 tasks (weeks 4 to 5) → R-PLAT-01, R-PLAT-04, R-PLAT-08, R-RSCH-06 backend, R-RESP-10 and R-RESP-11 backend

1. **Pricing** in `packages/core/pricing`. `priceStudy(brief, config) -> Quote` where total = core guide questions × target respondents × `unitPriceCents` (default 100). Probes and screeners are never billed. Line items show questions, respondents and unit price. Integer cents. Config read from `pricing_configs` with organization override. Also compute `incentiveCents` per complete from `incentivePerQuestionCents` (placeholder 40) and store `expectedMarginCents` on the quote. Tests `IT-2.3`.
2. **Stripe.** Checkout session creation for an approved quote, webhook `checkout.session.completed` launches the study, `charge.refunded` updates payment. Signature verification. Idempotent by event ID.
3. **Quality v1** in `packages/core/quality`. `scoreSession(signals) -> {score, components, decision}`.
   - Components and weights are specificity 30 (from Agent 3's LLM judge), relevance 25 (LLM judge), profile consistency 20 (re-asked fact match), behavioral 15 (answer durations, re-records, speed), liveness 10.
   - Approve at 60 or above. Review between 45 and 59. Remove below 45.
   - Weights and thresholds in config, not code.
4. **Quality hold job.** Runs 1 hour after submit, waits for transcripts and AI signals, scores, then approves, removes or sends to review. Removal creates a replacement invite.
5. **Payouts.** Tremendous client with idempotency key `payout:<session_id>`. Gift card catalog limited to a configured list. Annual cap check below $2,000 with a $50 buffer. Retries with backoff. `IT-2.2` and `IT-2.5`.
6. **Points ledger.** `awardPoints(reason, ref)` with unique constraint, milestone bonuses at 5, 10 and 25 approved completes, referral bonus after referee's first approved complete.
7. **Gate 2 suite** `IT-2.1` to `IT-2.6`, then support the first real study on preview.

## Gate 3 tasks (weeks 6 to 7) → R-PLAT-05, R-PLAT-06, R-PLAT-09, R-PLAT-10, R-PLAT-12

1. **Fraud controls.** Phone hash uniqueness, virtual number lookup through Twilio Lookup behind a flag, device fingerprint cap of 2 accounts, gift card recipient cap, audio sha256 duplicate detection across respondents, minimum plausible answer duration.
2. **Liveness v1.** Generate a 4-word phrase per session, Agent 2 records it first, transcript match by normalized edit distance of 2 or less.
3. **Retention job.** Delete audio after `delete_after`. Process deletion requests within 30 days. Export as JSON bundle.
4. **Admin console** at `/admin`. Studies list, session review queue with approve and remove, payout retry, pricing config editor with versioning, respondent ban.
5. **Observability.** Sentry, pino with request IDs, `llm_calls` dashboard query, alert on job failure rate over 5%.
6. **Gate 3 suite** `IT-3.3` (PII leak scan), `IT-3.4` (deletion), `IT-3.5` (k6 load). Own pilot operations checklist.

## Gate 4 tasks (week 8)
Security checklist, rate limits (OTP 5 per hour per phone, uploads 60 per hour per session), dependency audit, chaos tests `IT-4.2`, runbooks, debt sprint, final PRD reconciliation.

## Definition of done for your work
Every function in `packages/core` is pure, typed from contracts and unit-tested. Every function in `packages/services` has an integration test against Supabase local. Every webhook and job is idempotent and has a replay test. Every table has RLS and a test.
