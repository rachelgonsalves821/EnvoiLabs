# Envoi Labs PRD (north star)

> Product name: Envoi Labs. Do not hard-code the brand name outside `packages/ui/src/brand.ts` and the copy files.

| Field | Value |
| --- | --- |
| Doc owner | Rachel (product). Agents keep it current. |
| Status | v1 build in progress |
| Last updated | 2026-11-19 by Claude (initial version) |
| Design system | [Envoi Labs design system](https://claude.ai/artifact/JfVmxVS4SJQXzqePCWf2n2) |
| Decision record | Envoi Labs master doc (decisions log, 2026-11-19) |
| Build plan | `docs/BUILD_PLAN.md` |

## How agents use this document

This PRD is the single source of truth for **what** we are building and **why**. `docs/BUILD_PLAN.md` says **how** and **when**.

1. Read this whole file before starting any task.
2. Every requirement has an ID (for example `R-RESP-04`). Reference the ID in branch names, PR titles and commit messages.
3. When you start a requirement, set its Status to `In progress` and put your agent name in Owner. When it is merged with passing tests, set Status to `Done` and fill in the Evidence column with the test file path.
4. If you discover that a requirement is wrong, unclear or impossible, do not silently change it. Add an entry to section 14 (Open questions) with the ID, what you found and your proposed change, and set the requirement's Status to `Blocked` or `Needs decision`. Rachel decides.
5. If you make a change that affects behavior described here (a state, a field, a threshold), update the relevant section in the same PR and add a line to section 15 (Changelog).
6. Never delete a requirement. Mark it `Cut` with a reason in the changelog.

Status values are `Not started`, `In progress`, `Done`, `Blocked`, `Needs decision`, `Cut`.

## 1. North star

**For founders who do not have a direct line to their customers, Envoi Labs is the fastest, cheapest way to hear real people explain what they think and why, with evidence they can defend.**

Tagline "Real customers, before your next move."

North star metric is **decision-ready studies delivered per week**. A study counts when it fills its target completes, passes quality review and its report is opened by the researcher.

## 2. Problem

- Early founders need customer evidence to choose what to build, what to charge and when to pivot. They rarely have a panel, budget or research skill.
- Surveys give shallow answers. Human interviews are slow and expensive. Enterprise AI interview tools (Listen Labs, now being acquired by Salesforce) sell quote-only contracts to large companies.
- Respondents find existing panels tedious, with long screeners that pay nothing and slow payouts.

## 3. Users

| User | Who | Job to be done | Wins when |
| --- | --- | --- | --- |
| Researcher | MIT and Harvard founders first, then early-stage consumer brands (DTC, food and beverage, beauty, consumer apps) | Get a defensible answer to a decision, fast | Studies fill on time, data is trustworthy, the report is decision-ready |
| Respondent | US students and general consumers, 18+ | Earn money quickly from my phone without hassle | Matching is easy, interviews are short, pay is clear and fast |

## 4. Goals and non-goals for v1

**Goals**
1. A researcher goes from goal to approved, paid study in one sitting of under 15 minutes.
2. A study of 20 completes fills within 48 hours from the owned student and consumer panel.
3. The report arrives within 24 hours of the last complete, with every finding linked to transcripts.
4. A new respondent reaches their first paid interview within 10 minutes of signup.
5. Bad responses are caught, removed and replaced at no cost to the researcher.

**Non-goals for v1**
1. Statistically representative quant, market sizing or willingness-to-pay curves.
2. B2B executive or specialist audiences.
3. Strategy or "you should pivot" recommendations beyond proposing the next study.
4. Multiple countries or languages. US and English only.
5. Video, screen share or usability testing.
6. Native mobile apps. WhatsApp as an interview channel (waitlist only).
7. Respondents becoming researchers.
8. Cash, Venmo or PayPal payouts. Gift cards only.

## 5. Decisions already made (do not reopen without Rachel)

| Area | Decision |
| --- | --- |
| Market | United States |
| Respondents | Students and general consumers |
| First researchers | MIT and Harvard founders as prepaid design partners |
| Format | AI-moderated voice interview, 15 minute cap, 6 to 8 core questions |
| Follow-ups | Live AI probing in every study, 1 to 2 probes per question, not an add-on |
| Platform | Mobile-first web app (PWA) for respondents, desktop web app for researchers, one codebase |
| WhatsApp | Not in v1. Signup waitlist checkbox as a demand test, build in v1.1 if 30%+ opt in |
| Email | Not a nudge channel. Allowed for receipts and legal notices only |
| Payouts | Gift cards only, through Tremendous |
| Gamification | Points with stated cash value (100 points = $1), streaks, quality levels, milestone bonuses. No random prize draws |
| Privacy default | Researchers see redacted transcripts. Voice clips only on per-study respondent opt-in |
| Money | Prices and payouts come from deterministic code, never from an LLM |
| Price | $1 per core question per respondent. A 5-question study with 1 respondent costs $5. Follow-up probes are included, not billed |
| Turnaround | Fieldwork 24 to 48 hours, report within 24 hours of last complete |
| Naming | "Respondents" and "researchers" everywhere in code and copy |

## 6. Experience requirements

### 6.1 Respondent app (mobile-first PWA)

| ID | Requirement | Acceptance criteria | Owner | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| R-RESP-01 | Phone signup with one-time code | Phone number is the identity. No password. Code arrives by SMS. Duplicate numbers rejected. 18+ attestation captured. | Agent 2 with Agent 1 | In progress | |
| R-RESP-02 | Profile of 6 to 8 questions | Answerable by tap or voice. Stored as structured profile attributes. Takes under 2 minutes. | Agent 2 | Not started | |
| R-RESP-03 | Consent by purpose | Separate consent records for recording, third-party transcription, retention and researcher access. Versioned consent text. | Agent 2 | Not started | |
| R-RESP-04 | Invite card | Shows reward, minutes, question count, time left, one-line "why you", privacy line. Accept or "Not for me". Declining never penalizes. | Agent 2 | Not started | |
| R-RESP-05 | Confirming screener | 1 to 3 extra questions when a match is preliminary. Pays a small amount if over 60 seconds. Answers saved to profile. | Agent 2 | Not started | |
| R-RESP-06 | Interview screen | One question per screen. Progress "3 of 7" and reward chip always visible. Echo is the record button. "Type instead" always available. | Agent 2 | Not started | |
| R-RESP-07 | Voice capture and resume | Each answer uploads as soon as it is recorded. A nudge link resumes at the exact unanswered question. Re-record last answer allowed. | Agent 2 | Not started | |
| R-RESP-08 | Live follow-up display | Probe appears within 6 seconds p95 of the answer upload. Echo shows `think` state while waiting. | Agent 2 with Agent 3 | Not started | |
| R-RESP-09 | Nudges | Web push at the halfway point and with 2 hours left before 24h expiry. Snooze and decline allowed. Install-to-home-screen guide on iPhone after first payout. | Agent 2 | Not started | |
| R-RESP-10 | Receipt and payout | Instant receipt with amount, "pending quality check", expected date. Gift card choice after first completion. Payout sent after quality hold. | Agent 2 with Agent 1 | Not started | |
| R-RESP-11 | Points and levels | Points ledger with cash value shown. Streaks never claw back money. Milestone bonuses at 5, 10, 25 completes. Quality levels unlock higher-paying studies. | Agent 2 with Agent 1 | Not started | |
| R-RESP-12 | Privacy controls | Delete account, export data, stop invites, withdraw from a study, per-study voice sharing toggle. | Agent 2 | Not started | |
| R-RESP-13 | WhatsApp waitlist | Optional checkbox at signup, stored with timestamp. Reported as a demand metric. | Agent 2 | Not started | |
| R-RESP-14 | Referral loop | Paid respondent-to-respondent referral with unique link, bonus after the referee's first approved complete. | Agent 2 with Agent 1 | Not started | |

### 6.2 Researcher app (desktop-first)

| ID | Requirement | Acceptance criteria | Owner | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| R-RSCH-01 | Sign up and organization | Email magic link plus MFA (TOTP). One organization per researcher in v1. Terms acceptance recorded. | Agent 3 with Agent 1 | In progress | |
| R-RSCH-02 | Scoping chat | Agent asks one question at a time in order (decision, hypotheses, who, exclusions, how many, stimulus, deadline). Quick-reply chips. Researcher can paste their own questions. | Agent 3 | Not started | |
| R-RSCH-03 | Live brief | Brief panel fills as the chat progresses. Every change is announced in chat. Researcher can edit fields directly. | Agent 3 | Not started | |
| R-RSCH-04 | Sizing pushback | When a goal implies market sizing, the agent explains interviews cannot size and reframes. | Agent 3 | Not started | |
| R-RSCH-05 | Quote and feasibility | Price from the pricing formula with line items. Feasibility estimate from panel supply ("18 of your 30 in 48 hours"). Shown only when the brief is complete. | Agent 3 with Agent 1 | Not started | |
| R-RSCH-06 | Checkout and launch | Stripe Checkout. Payment confirmation launches the study automatically. Receipt emailed. | Agent 3 with Agent 1 | Not started | |
| R-RSCH-07 | Tracking page | Invited, accepted, completed, removed counts. Sample composition against spec. Projected finish. Live updates without reload. | Agent 3 | Not started | |
| R-RSCH-08 | Report | Executive answer, themes with counts ("11 of 20"), confidence per finding, quotes linked to transcripts, quality scores, segment cuts, methods appendix, hypothesis scores. | Agent 3 | Not started | |
| R-RSCH-09 | Next study proposal | Report ends with one scoped, priced follow-up study the researcher can launch in two clicks. | Agent 3 | Not started | |
| R-RSCH-10 | Transcripts and export | Redacted transcripts per respondent, audio clips where consented, CSV and PDF export. | Agent 3 | Not started | |
| R-RSCH-11 | Honest labels | Every study and report labeled "Directional qualitative". "Student convenience sample" label when over 50% students. No percentages below 30 completes. | Agent 3 | Not started | |

### 6.3 Platform, trust and operations

| ID | Requirement | Acceptance criteria | Owner | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| R-PLAT-01 | Pricing formula | Deterministic function `priceStudy(brief, config)` = core questions × target respondents × unit price (default 100 cents). Probes and screeners are not billed. Config in DB, versioned. Every quote stores the config version. | Agent 1 | Not started | |
| R-PLAT-02 | Matching | SQL filter on profile attributes plus participation caps and cooldowns. Feasibility estimate from eligible active respondents and historical accept and complete rates. | Agent 1 | Not started | |
| R-PLAT-03 | Study, invite, session and payout state machines | Explicit states and transitions as in section 9. Illegal transitions throw. Every transition writes an audit row. | Agent 1 | Not started | |
| R-PLAT-04 | Quality scoring | Per-response score 0 to 100 from specificity, relevance, consistency with profile and behavioral signals. Below threshold auto-flags for removal and triggers a replacement invite. | Agent 1 with Agent 3 | Not started | |
| R-PLAT-05 | Fraud controls | One account per phone, device and gift card recipient caps, virtual number detection, speed and duplicate audio checks. | Agent 1 | Not started | |
| R-PLAT-06 | Voice liveness (v1 light) | Random spoken phrase before each study, checked by transcript match. Speaker match is a v1.1 stretch. | Agent 1 with Agent 2 | Not started | |
| R-PLAT-07 | Redaction | Names, emails, phone numbers, addresses and employers removed from transcripts before any researcher view. Raw text never reaches researcher endpoints. | Agent 3 | Not started | |
| R-PLAT-08 | Payout service | Tremendous gift card orders with idempotency keys, quality hold of 24 to 48 hours, annual cap per respondent below $2,000. | Agent 1 | Not started | |
| R-PLAT-09 | Retention | Raw audio deleted 60 days after transcription and quality review. Deletion and export requests honored within 30 days. | Agent 1 | Not started | |
| R-PLAT-10 | Admin console | Internal page to view studies, override quality decisions, re-send payouts and adjust pricing config. Behind an admin role. | Agent 1 | Not started | |
| R-PLAT-11 | Analytics events | Event schema in section 11 emitted from server code. | Agent 1 | Not started | |
| R-PLAT-12 | Observability | Structured logs, error tracking, job dashboards, LLM cost and latency per call. | Agent 1 | Not started | |

## 7. AI behavior specifications

All LLM calls go through `packages/ai`. Prompts live in versioned files. Every agent has an eval set that runs in CI (see BUILD_PLAN section 7).

### 7.1 Scoping agent (researcher side)
- Inputs are the chat history and the current brief object.
- Outputs are the next chat message plus a structured brief patch validated by the `BriefPatch` schema. The agent never outputs prices.
- Order of questions is decision, hypotheses, must-have and nice-to-have criteria (written as behavior in a time window), exclusions, number of completes, stimulus, deadline.
- One question per message, under 80 words, with 2 to 4 quick replies including "Something else".
- Pushes back on sizing goals with a plain explanation.
- Drafts the interview guide when the brief is complete. The guide has 6 to 8 core questions, open-ended, non-leading, about the respondent's own past behavior.

### 7.2 Interviewer agent (respondent side)
- Triggered when an answer transcript lands.
- Decides `probe` or `next`. Maximum 2 probes per core question. Total interview time stays under 15 minutes.
- Probes are about the respondent's own experience ("What made you pick that app?"), never leading, never revealing the client, never answering questions outside the interview.
- Re-asks one profile fact once per interview as a consistency check.
- Latency budget p95 under 6 seconds from upload complete to probe shown, including transcription.

### 7.3 Analyst agent (researcher side)
- Runs when fieldwork completes or the researcher clicks "Analyze now" after at least 10 completes.
- Map step codes each redacted transcript against the brief's hypotheses. Reduce step clusters codes into themes.
- Each theme has a one-sentence claim, the count of respondents, confidence (High when 60%+ of respondents and consistent, Medium when 30 to 60%, Low otherwise), up to 10 supporting quote references and contradicting quotes.
- Every quote in the report must resolve to an exact span in a stored transcript. A post-check rejects any quote that does not match.
- Proposes one follow-up study as a brief draft.

### 7.4 Transcription
- Default provider `gpt-4o-mini-transcribe`, fallback Groq Whisper. Behind a provider interface.
- Store provider, model, latency and cost per transcript.

## 8. Trust and privacy

- Respondent promise "Researchers never get your name, phone number or contact details, and we remove personal details from transcripts. If you choose to share your voice, someone may recognize it." Never say "anonymous".
- Phone numbers are stored encrypted and never joined into researcher-facing queries. Researcher-facing tables and views exclude PII columns by construction (separate schema with RLS).
- Consent text is versioned and every consent record stores the version.
- Counsel review is required before public launch for voice consent (Illinois BIPA and similar), international student incentive eligibility, and Harvard and MIT recruiting rules. Track in section 14.

## 9. Domain model and state machines

### Entities
`organization`, `researcher`, `respondent`, `respondent_pii` (phone, encrypted), `profile_attribute`, `consent`, `study`, `brief_version`, `criterion`, `guide_question`, `pricing_config`, `quote`, `payment`, `invite`, `screener_answer`, `session`, `answer`, `audio_object`, `transcript`, `probe`, `quality_score`, `removal`, `payout`, `points_entry`, `referral`, `report`, `finding`, `evidence_quote`, `push_subscription`, `whatsapp_waitlist`, `audit_log`, `event`.

### Study states
`draft` → `scoping` → `brief_ready` → `awaiting_payment` → `fielding` → `fieldwork_complete` → `analyzing` → `report_ready` → `closed`. Side states `paused` and `cancelled` (refund rules in section 14).

### Invite states
`matched` → `screening` (optional) → `invited` → `accepted` | `declined` | `expired` | `screened_out`.

### Session states
`started` → `in_progress` → `submitted` → `quality_hold` → `approved` | `removed`. `approved` → `paid`. `in_progress` → `abandoned` at 24h expiry.

### Payout states
`pending` → `ordered` → `delivered` | `failed`. `failed` → `ordered` on retry with the same idempotency key.

## 10. Pricing

**Decided 2026-11-19.** Researchers pay **$1 per core question per respondent**. A 5-question study answered by 1 respondent costs $5. A 7-question study with 20 respondents costs $140. Live follow-up probes are included and never billed. Screener questions are not billed.

| Parameter | Value | Notes |
| --- | --- | --- |
| Unit price | 100 cents per core question per respondent | Decided. Stored in `pricing_configs` so it can change without a deploy |
| Billed questions | Core guide questions only | Probes and screeners free |
| Question limit | 4 to 10 core questions | Keeps interviews under 15 minutes |
| Minimum study | Open (Q-01b) | Suggested 5 respondents |
| Respondent incentive | Open (Q-01). Placeholder 40 cents per core question | See economics below |
| Design partner pricing | Same unit price, `pricing_override_id` available for credits | |

**Economics warning.** At $1 per question, a 7-question interview earns $7. Recruiting a new respondent costs roughly $25, spread over about 4 completes, so about $6 per complete early on. Paying respondents $0.70 per minute as originally planned loses about $8 per complete. Paying 40 cents per question ($2.80 for a 7-question interview, about $17 an hour) still loses about $3.50 per complete early and earns about 10% margin once the panel is mature and recruiting cost falls near $2 per complete. Track `margin_per_complete_cents` from day one (section 11).

## 11. Success metrics and events

| Metric | Target for pilot | Event source |
| --- | --- | --- |
| Goal to paid study time | Median under 15 min | `study.created`, `payment.succeeded` |
| 24h fill rate | 70%+ of target | `session.approved` |
| Respondent signup to first paid interview | Median under 10 min | `respondent.signed_up`, `session.submitted` |
| Interview completion rate after accept | 70%+ | `invite.accepted`, `session.submitted` |
| Unusable transcript rate | Under 15% | `quality.removed` |
| Probe latency p95 | Under 6 s | `probe.shown` |
| Cost per activated respondent | Under $25 | Ads spend plus `respondent.activated` |
| Margin per complete | Positive by end of pilot | `quote` revenue minus incentive, payout fees and attributed recruiting |
| Report opened within 24h of delivery | 80%+ | `report.viewed` |
| WhatsApp waitlist opt-in | Decide v1.1 at 30% | `waitlist.whatsapp_opted_in` |

Every event has `event_name`, `occurred_at`, `actor_type`, `actor_id` (hashed for respondents), `study_id` where relevant, and a typed `props` object defined in `packages/contracts`.

## 12. Design

Follow the design system at the link above. Summary for agents.
- One typeface, Manrope. Colors `fog`, `paper`, `ink`, `pulse` (one loud moment per view), `zest` (money only), `tide` (researcher data).
- The Echo, a WebGL 3D voice orb, is the record button and the agent's presence. One per view.
- Sentence case, no em dashes, no all-caps labels, concrete numbers.
- WCAG AA in light and dark themes. 44px minimum targets, 96px+ record button.

## 13. Release plan

| Gate | Target | Meaning |
| --- | --- | --- |
| Gate 0 | End of week 1 | Foundations ready |
| Gate 1 | End of week 3 | Vertical slice, one study end to end with seeded data |
| Gate 2 | End of week 5 | Money loop and scoping, first real study with hand-recruited respondents |
| Gate 3 | End of week 7 | Probing, reports, quality, pilot with 30 to 50 respondents and 2 to 3 founders |
| Gate 4 | End of week 8 | Launch hardening |

Details in `docs/BUILD_PLAN.md`.

## 14. Open questions

| ID | Question | Raised by | Proposed answer | Decision |
| --- | --- | --- | --- | --- |
| Q-01 | Respondent incentive per core question given the $1 price (30 or 40 cents), and whether to add a per-study platform fee or bill probes to reach positive margin | Claude | 40 cents, review after pilot margin data | Open |
| Q-01b | Minimum respondents per study | Claude | 5 | Open |
| Q-02 | iPhone nudge for respondents who never install the PWA. Ask after first payout, one-time SMS link, or both | Claude | Both, SMS behind a flag | Open |
| Q-03 | Where the first 100 respondents come from beyond MIT and Harvard | Council | Campus ambassadors plus $3k ads test | Open |
| Q-04 | Can international students on study visas accept paid incentives | Claude | Counsel review before launch | Open |
| Q-05 | Harvard and MIT rules for recruiting students into paid commercial studies | Claude | Counsel review before launch | Open |
| Q-06 | Voice consent and retention under BIPA and similar | Council | Counsel review before launch | Open |
| Q-07 | Add Tremendous prepaid Visa to the catalog | Claude | Yes if fees stay at zero | Open |
| Q-08 | Refund policy when a study cannot fill | Claude | Pro-rata refund of unfilled completes | Open |
| Q-09 | Final product name | Rachel | Envoi Labs | Decided |

## 15. Changelog

| Date | Who | Change |
| --- | --- | --- |
| 2026-11-19 | Claude | Initial PRD from notes, council review and decisions log |
| 2026-11-19 | Rachel via Claude | Pricing set to $1 per core question per respondent. Section 10 rewritten, R-PLAT-01 updated, Q-01 reframed as incentive and margin question |
| 2026-11-19 | Rachel | Set the product name to Envoi Labs. |
