# Envoi Labs PRD (north star)

> Product name: Envoi Labs. Do not hard-code the brand name outside `packages/ui/src/brand.ts` and the copy files.

| Field | Value |
| --- | --- |
| Doc owner | Rachel (product). Agents keep it current. |
| Status | v1 build in progress |
| Last updated | 2026-11-20 by Claude (user journeys, design guidelines, open-source building blocks) |
| Design system | [Envoi Labs design system](https://claude.ai/artifact/JfVmxVS4SJQXzqePCWf2n2) |
| Decision record | Envoi Labs master doc (decisions log, 2026-11-19) |
| Build plan | `docs/BUILD_PLAN.md` (open-source references in section 11) |

## What changed since the first version

Read this if you started from an earlier copy.

1. **Pricing is decided** at $1 per core question per respondent (sections 5 and 11, R-PLAT-01, R-RSCH-05). Respondent incentive per question is still open (Q-01).
2. **Open-source references.** Evaluate Presidio for the first redaction pass (R-PLAT-07). Report quotes follow OpenVerbatim's grounding approach (R-RSCH-08, section 8.3). The interviewer and analyst build on a review of OpenInterviewer (section 8). Panel, matching, quality scoring, payouts and pricing stay proprietary (section 5).
3. **New sections.** Detailed user journeys for respondents and researchers built from the original notes (section 6), full design guidelines (section 13) and open-source building blocks (section 14). Sections after 5 were renumbered, so check references.
4. **The product name is Envoi Labs** (Q-09). Keep the brand name in `packages/ui/src/brand.ts` and the copy files.

## How agents use this document

This PRD is the single source of truth for **what** we are building and **why**. `docs/BUILD_PLAN.md` says **how** and **when**.

1. Read this whole file before starting any task.
2. Every requirement has an ID (for example `R-RESP-04`). Reference the ID in branch names, PR titles and commit messages.
3. When you start a requirement, set its Status to `In progress` and put your agent name in Owner. When it is merged with passing tests, set Status to `Done` and fill in the Evidence column with the test file path.
4. If you discover that a requirement is wrong, unclear or impossible, do not silently change it. Add an entry to section 16 (Open questions) with the ID, what you found and your proposed change, and set the requirement's Status to `Blocked` or `Needs decision`. Rachel decides.
5. If you make a change that affects behavior described here (a state, a field, a threshold), update the relevant section in the same PR and add a line to section 17 (Changelog).
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
| Email | Sign-in links for respondents and researchers, plus receipts and legal notices. Study nudges appear in the respondent app and via web push. |
| Payouts | Gift cards only, through Tremendous |
| Gamification | Points with stated cash value (100 points = $1), streaks, quality levels, milestone bonuses. No random prize draws |
| Privacy default | Researchers see redacted transcripts. Voice clips only on per-study respondent opt-in |
| Money | Prices and payouts come from deterministic code, never from an LLM |
| Proprietary core | The panel, matching, quality scoring, payouts and pricing are written in-house. No third-party code in those areas (BUILD_PLAN section 11) |
| Open-source reuse | MIT, Apache-2.0 or BSD only, with notices kept in `THIRD_PARTY_NOTICES.md`. No AGPL or GPL code |
| Price | $1 per core question per respondent. A 5-question study with 1 respondent costs $5. Follow-up probes are included, not billed |
| Turnaround | Fieldwork 24 to 48 hours, report within 24 hours of last complete |
| Naming | "Respondents" and "researchers" everywhere in code and copy |

## 6. User journeys

These journeys turn Rachel's original handwritten notes into the v1 experience. Where a v1 decision changed the notes, the step says so. Every step names the requirements it covers so agents can trace screens back to IDs in section 7.

### 6.0 How the original notes map to v1

| Original note | v1 decision | Why |
| --- | --- | --- |
| Respondent account with MFA | Persistent respondent account with passwordless email sign-in | A one-time email link opens the respondent account. Researcher sign-in also requires authenticator MFA. |
| One general survey (age, gender, etc.) | 6 to 8 profile questions, grown over time by confirming screeners | Keeps signup under 2 minutes and avoids re-asking |
| Waiver sign | Consent by purpose (recording, transcription vendor, retention, researcher access, voice clip sharing) | Voice is sensitive data. One waiver is not enough |
| WhatsApp messages or in-app | Web app only in v1. WhatsApp waitlist at signup, build in v1.1 if 30%+ opt in | Keeps the first release focused on one interview channel |
| Surveys live 24 hours, agents nudge stalls | Kept. Two nudges by web push, resume at the exact question | Matches the notes |
| Paid within a week, points toward prizes | Gift cards after a 24 to 48 hour quality hold. Points with a cash value and milestone bonuses. No prize draws | Keeps rewards deterministic |
| Completers can become researchers | Not in v1. Paid respondent referrals instead | Different buyer, conflicts of interest |
| Researcher price by participants, complexity, screening | $1 per core question per respondent | Decided 2026-11-19 |
| Follow-up questions as a paid opt-in | Live follow-ups in every study, never billed | Probing is where interview value comes from |
| Analysis and transcripts within 3 days | Fieldwork 24 to 48 hours, report within 24 hours of the last complete | Faster than the notes, worst case still 3 days |
| Proposed follow-up survey ("pivot intelligence") | Report scores each hypothesis and proposes one priced next study | Says what to test next, never "pivot to X" |
| Name and PII never shared | Researchers never get name, phone or contact details. Transcripts redacted. Voice clips only on per-study opt-in | A voice can identify someone, so the promise is precise |

### 6.1 Respondent journey

**Who.** Maya, 20, a college junior who orders food late at night a few times a week. She has 10 spare minutes between classes, an iPhone, and no patience for long forms. She wants easy money and to know her answers stay private.

**Goal.** From link to first paid interview in under 10 minutes. Every later interview takes one tap to start.

The respondent has a persistent account in the Envoi web app. Home shows study invites the respondent can act on, plus any pending screener or in-progress interview. Earnings is where the respondent sees rewards, chooses a gift card brand and checks payout history. A one-time email link signs the respondent into that same account on return. Study activity and reminders live in the app, with web push when enabled.

| Stage | What Maya sees and does | What the system does | Requirements |
| --- | --- | --- | --- |
| 1. Discover | Scans a campus QR code or taps a friend's referral link. Lands on a page that says "Talk for 10 minutes. Get paid." with an approved reward example and one button, "Get started" | Records the source (QR, referral code, ad) | R-RESP-14 |
| 2. Sign up | Enters her email address, confirms she is 18 or older, and opens the one-time sign-in link in the same browser. Optional checkbox "Prefer to answer on WhatsApp? Join the waitlist" | Creates or retrieves the account linked to the verified Supabase Auth identity, records the first age attestation, blocks duplicate respondent accounts and stores the waitlist opt-in | R-RESP-01, R-RESP-13, R-PLAT-05 |
| 3. Profile | Answers 6 to 8 quick questions by tap or voice. Age range, gender, student status and year, on or off campus, region (ZIP), how often she orders food or shops online, and 2 or 3 interest categories. Takes under 2 minutes | Saves each answer as a profile attribute so it is never asked again | R-RESP-02 |
| 4. Consent | One screen with plain-language toggles. Recording and transcription for voice answers, retention, researcher access to redacted transcripts and optional per-study voice sharing. Voice sharing is off for the first real study. Link to full terms | Stores one consent record per purpose with the text version | R-RESP-03 |
| 5. First match | Signed-in Home shows her eligible study invites, a pending screener when required, or "We're finding your first match" with an estimated time | Matching runs on her profile, respecting caps and cooldowns | R-PLAT-02 |
| 6. Confirming screener (sometimes) | When a match is preliminary, a sheet asks 1 to 3 approved questions by typing or voice ("Have you ordered food after 10pm in the last 30 days?"). Paid a small amount if it takes over 60 seconds | Typed answers and consented voice transcripts enter the screening check. Confirmed facts can update her profile. If she does not qualify she sees "Not a fit this time. We'll find you another one" with no penalty | R-RESP-05 |
| 7. Invite | Invite card shows time left ("Ends in 23 h"), topic in plain words, reward in lime, minutes, number of questions, one line on why she was picked, and the privacy line. Buttons "Start answering" and "Not for me" | Push notification sent if she has installed the app. Invite expires in 24 hours | R-RESP-04, R-RESP-09 |
| 8. Liveness check | Reads a 4-word phrase out loud ("blue river seven lamp") | Transcript compared to the phrase. A mismatch flags the session for review | R-PLAT-06 |
| 9. Interview | One question per screen. Progress "3 of 7" top left, reward chip top right. Taps the Echo to record, taps again to stop. Sees "Got it" and the next question. "Type instead" always available | Each answer uploads immediately and is kept locally until confirmed. Transcription runs. The interviewer decides to probe or move on | R-RESP-06, R-RESP-07 |
| 10. Follow-ups | After some answers the Echo pulses while a follow-up is written, then a short probe appears ("What made you pick that app over walking to the store?"). At most 2 per question | Probe shown within 6 seconds at p95. If none arrives in 8 seconds the interview moves on | R-RESP-08, section 8.2 |
| 11. Stalls | If she stops halfway, she gets a push showing her progress and the agreed reward and another with 2 hours left. Tapping resumes at the exact question | Nudge jobs run on the session's 24-hour clock | R-RESP-09 |
| 12. Finish | Receipt screen. The Echo flashes lime once, the amount counts up, "Pending quality check, expected by Friday" | Session enters the quality hold. Score combines specificity, relevance, profile consistency, behavior and liveness | R-RESP-10, R-PLAT-04 |
| 13. Get paid | After her first approved interview she picks a gift card brand in Earnings. Later payouts go automatically. Earnings shows the status and history of her gift cards | Tremendous order with an idempotency key. Annual cap kept under $2,000 | R-RESP-10, R-PLAT-08 |
| 14. Keep coming back | Earnings tab shows total earned, points with cash value (100 points = $1), streak, next milestone bonus (5, 10, 25 completes) and quality level. iPhone users see a 3-step "Add to Home Screen" guide after the first payout so nudges reach them | Points ledger, milestone bonuses, quality levels unlock higher-paying studies | R-RESP-11, R-RESP-09 |
| 15. Control her data | Settings let her stop invites, withdraw from a study, toggle voice sharing per study, export her data, or delete her account | Deletions honored within 30 days, audio deleted after 60 days | R-RESP-12, R-PLAT-09 |

**Edge cases the build must handle**
- Microphone permission denied. Explain how to enable it and offer "Type instead".
- Upload fails or the phone goes offline. Keep the recording on the device, retry 3 times, show "Saved on your phone, sending when you're back online".
- Audio unclear or too short. "We couldn't hear that one. Tap to try again, or type instead."
- Invite expires mid-interview. Answers so far are kept for quality signals, no payout, and the copy is kind ("This one closed. New matches are on the way").
- Removed for quality. She sees "This interview didn't pass our quality check, so it isn't paid", with a link to the quality guidelines and a way to contact support. Repeated removals lower her level.
- Payout cap reached. Flag potential cap conflicts before an invite or payout commitment and route exceptions to Platform for review.
- Under 18 or banned. Signup or invites are blocked with neutral copy. Returning with a verified email opens the existing account.

**Journey metrics.** Signup to first paid interview under 10 minutes (median). Completion after accept 70%+. Respondent satisfaction after the receipt 4.5 of 5 or higher.

### 6.2 Researcher journey

**Who.** Sam, a second-year MBA founder building a late-night snack delivery app for college students. He needs to decide whether students will pay a delivery fee, and how much, before launch. He has no panel and no research budget beyond a few hundred dollars.

**Goal.** From a vague goal to a paid, launched study in one sitting of under 15 minutes. A decision-ready report within 3 days.

| Stage | What Sam sees and does | What the system does | Requirements |
| --- | --- | --- | --- |
| 1. Sign up | For hosted preview, a trusted operator provisions his account and organization membership and records accepted terms. He opens the delivered email link and completes TOTP before entering the workspace. Collect role, company stage and decision goals in onboarding when that flow is implemented | Records organization membership and MFA assurance. Design partner pricing overrides are configured individually | R-RSCH-01 |
| 2. Start a study | An empty screen asks "What decision are you trying to make? Start there and I'll draft the study." He types his goal, or pastes questions he already has | Scoping agent starts. The live brief panel appears on the right with every section as a placeholder | R-RSCH-02, R-RSCH-03 |
| 3. Scoping conversation | The agent asks one question at a time with quick-reply chips. The decision ("Set the fee price"), 2 or 3 hypotheses, who to hear from (must have vs. nice to have, written as behavior such as "ordered food after 10pm in the last 30 days"), exclusions, how many people, any concept or price to show, and the deadline | Each answer updates the brief, and the chat says what changed ("Added 2 criteria to your brief"). If he asks a sizing question ("What percent would pay?"), the agent explains interviews can't size a market and reframes | R-RSCH-02, R-RSCH-03, R-RSCH-04 |
| 4. Review the guide | The agent drafts 6 to 8 open, non-leading questions about past behavior. He can edit, reorder or ask for rewrites. Pasted questions that are leading get flagged with a suggested rewrite | Guide stored as a versioned brief. Limit of 4 to 10 core questions | R-RSCH-02, section 8.1 |
| 5. Quote and feasibility | Sees "$140" with line items "7 questions × 20 respondents × $1", that follow-ups are included, and "We expect all 20 within 36 hours" with a status chip | Price from the pricing formula, never from the agent. Feasibility from eligible active respondents and historic accept and completion rates. If feasibility is low, suggests loosening a criterion before he pays | R-RSCH-05, R-PLAT-01, R-PLAT-02 |
| 6. Pay and launch | Clicks "Approve and pay $140", pays on Stripe Checkout, returns to a "Study launched" screen | Payment webhook launches the study. Invites go out in waves | R-RSCH-06 |
| 7. Track | Tracking page shows completes against target ("14 of 20"), invited, accepted, completed, removed and replaced, sample composition against his criteria, and the projected finish. Updates live | Removals for quality are listed with "replaced free". If fill is slow, more invites are added automatically and the status turns to warn | R-RSCH-07 |
| 8. Read transcripts early | Opens redacted transcripts as they arrive, with each respondent described by profile facts, never by name | Redaction runs before anything reaches him | R-RSCH-10, R-PLAT-07 |
| 9. Report | Within 24 hours of the last complete, gets the report in the workspace. The answer to his decision first, then themes as one-sentence claims with counts ("11 of 20 said a fee feels fair under $3"), confidence per finding, a lead quote with audio if consented, contradictions, segment cuts and a methods appendix. Every study is labeled "Directional qualitative" and, here, "Student convenience sample" | Analyst agent with grounded quotes. Percentages never shown below 30 completes | R-RSCH-08, R-RSCH-11, section 8.3 |
| 10. Next study | At the end, a proposed follow-up ("Test a $2.49 fee against a $5 monthly pass with 20 off-campus students"), already scoped and priced. Launchable in two clicks | Next-study brief drafted from the analysis and opened in the scoping screen | R-RSCH-09 |
| 11. Export and share | Downloads a PDF report or CSV of themes and quotes to share with his co-founder or investors | Export respects consent and redaction | R-RSCH-10 |

**Edge cases the build must handle**
- Criteria too narrow to fill. Show the low feasibility before payment and suggest which criterion to loosen. If a paid study still cannot fill, apply the refund policy once Q-08 is decided.
- More than 10 pasted questions. Suggest splitting into two studies or cutting to the strongest 8.
- Leading or double-barrelled questions. Flag and offer a rewrite. Never silently change his wording.
- A goal that needs statistics. Explain plainly what interviews can and cannot tell him.
- Payment fails or is abandoned. The brief stays saved as a draft.
- He asks for respondent contact details or names. Decline and explain the privacy promise.
- He wants to stop early. Pause the study, keep completes, apply the approved refund policy once Q-08 is decided.

**Journey metrics.** Goal to paid study under 15 minutes (median). 24-hour fill rate 70%+. Report opened within 24 hours of delivery 80%+. Share of founders who launch a second study within 30 days.

### 6.3 Where AI is used (from the notes)

| Notes item | v1 owner | Where |
| --- | --- | --- |
| Respondent matching | Deterministic SQL with participation caps and cooldowns | R-PLAT-02 |
| Confirming screening | An LLM interprets free-text or transcribed answers against approved behavioral criteria after matching. Platform applies the screening rules | R-RESP-05, R-PLAT-02, Section 8.5 |
| Respondent recruiting | Not AI in v1. Campus, referral and ads tracked by source | R-RESP-14 |
| Survey nudges | Templated, scheduled by the session clock, not AI | R-RESP-09 |
| Live survey follow-ups | Interviewer agent | Section 8.2 |
| Survey design and pricing | Scoping agent designs, pricing is a formula | Section 8.1, R-PLAT-01 |
| Voice to text | Transcription provider behind an interface | Section 8.4 |
| Analytics and follow-up proposal | Analyst agent | Section 8.3, R-RSCH-09 |

## 7. Experience requirements

### 7.1 Respondent app (mobile-first PWA)

| ID | Requirement | Acceptance criteria | Owner | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| R-RESP-01 | Respondent account and email sign-in | A one-time link verifies access to the email address. First verified sign-in creates a persistent account and records the 18+ attestation. Return sign-in opens the same account and preserves saved activity. | Agent 2 with Agent 1 | Done | [Disposable email and MFA flow](../apps/web/e2e/auth-local.spec.ts) and [hosted evidence](STATUS.md#2026-11-21-platform-gate-0-passed-under-rachels-delegation). [Account continuity test](../packages/db/tests/respondent_auth_provisioning.sql). |
| R-RESP-02 | Profile of 6 to 8 questions | Answerable by tap or voice. Stored as structured profile attributes. Takes under 2 minutes. | Agent 2 | In progress | [Disposable browser flow](../apps/web/e2e/auth-local.spec.ts) |
| R-RESP-03 | Consent by purpose | Separate consent records for recording, third-party transcription, retention and researcher access. Versioned consent text. | Agent 2 | In progress | [Onboarding access and persistence checks](../packages/db/tests/respondent_onboarding.sql) |
| R-RESP-04 | Eligible studies on respondent Home | Signed-in Home shows the respondent's own eligible invites and indicates when a screener is required. Cards show reward, minutes, question count, time left, one-line "why you" and privacy. Accept or "Not for me". Declining never penalizes. | Agent 2 | Not started | |
| R-RESP-05 | Confirming screener | 1 to 3 approved questions when a match is preliminary. Accept typed or consented spoken answers. Interpret ambiguous answers using section 8.5. Pays a small amount if over 60 seconds. Save confirmed profile facts. | Agent 2 | Not started | |
| R-RESP-06 | Interview screen | One question per screen. Progress "3 of 7" and reward chip always visible. Echo is the record button. "Type instead" always available. | Agent 2 | Not started | |
| R-RESP-07 | Voice capture and resume | Each answer uploads as soon as it is recorded. A nudge link resumes at the exact unanswered question. Re-record last answer allowed. | Agent 2 | Not started | |
| R-RESP-08 | Live follow-up display | Probe appears within 6 seconds p95 of the answer upload. Echo shows `think` state while waiting. | Agent 2 with Agent 3 | Not started | |
| R-RESP-09 | Nudges | Web push at the halfway point and with 2 hours left before 24h expiry. Snooze and decline allowed. Install-to-home-screen guide on iPhone after first payout. | Agent 2 | Not started | |
| R-RESP-10 | Receipt and payout | Instant receipt with amount, "pending quality check", expected date. Gift card brand choice in Earnings after the first approved completion. Payout is sent after quality hold. The respondent can view their own payout status and gift card history in Earnings. | Agent 2 with Agent 1 | Not started | |
| R-RESP-11 | Points and levels | Points ledger with cash value shown. Streaks never claw back money. Milestone bonuses at 5, 10, 25 completes. Quality levels unlock higher-paying studies. | Agent 2 with Agent 1 | Not started | |
| R-RESP-12 | Privacy controls | Delete account, export data, stop invites, withdraw from a study, per-study voice sharing toggle. | Agent 2 | Not started | |
| R-RESP-13 | WhatsApp waitlist | Optional checkbox at signup, stored with timestamp. Reported as a demand metric. | Agent 2 | Not started | |
| R-RESP-14 | Referral loop | Paid respondent-to-respondent referral with unique link, bonus after the referee's first approved complete. | Agent 2 with Agent 1 | Not started | |

### 7.2 Researcher app (desktop-first)

| ID | Requirement | Acceptance criteria | Owner | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| R-RSCH-01 | Sign up and organization | Email magic link plus MFA (TOTP). One organization per researcher in v1. Terms acceptance recorded. | Agent 3 with Agent 1 | Done | [Disposable email and MFA flow](../apps/web/e2e/auth-local.spec.ts) and [hosted evidence](STATUS.md#2026-11-21-platform-gate-0-passed-under-rachels-delegation). |
| R-RSCH-02 | Scoping chat | Agent asks one question at a time in order (decision, hypotheses, who, exclusions, how many, stimulus, deadline). Quick-reply chips. Researcher can paste their own questions. | Agent 3 | Not started | |
| R-RSCH-03 | Live brief | Brief panel fills as the chat progresses. Every change is announced in chat. Researcher can edit fields directly. | Agent 3 | Not started | |
| R-RSCH-04 | Sizing pushback | When a goal implies market sizing, the agent explains interviews cannot size and reframes. | Agent 3 | Not started | |
| R-RSCH-05 | Quote and feasibility | Price from the pricing formula ($1 × core questions × respondents) with line items, for example "7 questions × 20 respondents × $1 = $140". Feasibility estimate from panel supply ("18 of your 30 in 48 hours"). Shown only when the brief is complete. | Agent 3 with Agent 1 | Not started | |
| R-RSCH-06 | Checkout and launch | Stripe Checkout. Payment confirmation launches the study automatically. Receipt emailed. | Agent 3 with Agent 1 | Not started | |
| R-RSCH-07 | Tracking page | Invited, accepted, completed, removed counts. Sample composition against spec. Projected finish. Live updates without reload. | Agent 3 | In progress (Researcher and AI) | [Tracking counts and tenant scope](../packages/db/tests/study_tracking.sql) |
| R-RSCH-08 | Report | Executive answer, themes with counts ("11 of 20"), confidence per finding, quotes linked to transcripts and grounded to exact spans (OpenVerbatim approach), quality scores, segment cuts, methods appendix, hypothesis scores. | Agent 3 | Not started | |
| R-RSCH-09 | Next study proposal | Report ends with one scoped, priced follow-up study the researcher can launch in two clicks. | Agent 3 | Not started | |
| R-RSCH-10 | Transcripts and export | Redacted transcripts per respondent, audio clips where consented, CSV and PDF export. | Agent 3 | Not started | |
| R-RSCH-11 | Honest labels | Every study and report labeled "Directional qualitative". "Student convenience sample" label when over 50% students. No percentages below 30 completes. | Agent 3 | Not started | |

### 7.3 Platform, trust and operations

| ID | Requirement | Acceptance criteria | Owner | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| R-PLAT-01 | Pricing formula | Deterministic function `priceStudy(brief, config)` = core questions × target respondents × unit price (default 100 cents). Probes and screeners are not billed. Config in DB, versioned. Every quote stores the config version. | Agent 1 | Not started | |
| R-PLAT-02 | Matching | SQL filter on profile attributes plus participation caps and cooldowns. Feasibility estimate from eligible active respondents and historical accept and complete rates. | Agent 1 | Not started | |
| R-PLAT-03 | Study, invite, session and payout state machines | Explicit states and transitions as in section 10. Illegal transitions throw. Every transition writes an audit row. | Agent 1 | In progress (Platform) | [Pure transition tests](../packages/core/test/state.test.ts) |
| R-PLAT-04 | Quality scoring | Per-response score 0 to 100 from specificity, relevance, consistency with profile and behavioral signals. Below threshold auto-flags for removal and triggers a replacement invite. | Agent 1 with Agent 3 | Not started | |
| R-PLAT-05 | Fraud controls | One account per verified email. Device and gift card recipient caps, speed and duplicate audio checks. | Agent 1 | Not started | |
| R-PLAT-06 | Voice liveness (v1 light) | Random spoken phrase before each study, checked by transcript match. Speaker match is a v1.1 stretch. | Agent 1 with Agent 2 | Not started | |
| R-PLAT-07 | Redaction | Names, emails, phone numbers, addresses and employers removed from transcripts before any researcher view. An evaluated deterministic analyzer followed by approved contextual redaction. Presidio is the first candidate (BUILD_PLAN section 11). Recall 99%+ for phones and emails, 95%+ for names and employers on the redaction eval. Raw text never reaches researcher endpoints. | Agent 3 | Not started | |
| R-PLAT-08 | Payout service | Tremendous gift card orders with idempotency keys, quality hold of 24 to 48 hours, annual cap per respondent below $2,000. | Agent 1 | Not started | |
| R-PLAT-09 | Retention | Raw audio deleted 60 days after transcription and quality review. Deletion and export requests honored within 30 days. | Agent 1 | Not started | |
| R-PLAT-10 | Admin console | Internal page to view studies, override quality decisions, re-send payouts and adjust pricing config. Behind an admin role. | Agent 1 | Not started | |
| R-PLAT-11 | Analytics events | Event schema in section 12 emitted from server code. | Agent 1 | Not started | |
| R-PLAT-12 | Observability | Structured logs, error tracking, job dashboards, LLM cost and latency per call. | Agent 1 | Not started | |

## 8. AI behavior specifications

All LLM calls go through `packages/ai`. Prompts live in versioned files. Every agent has an eval set that runs in CI (see BUILD_PLAN section 7). The interviewer and analyst designs start from Agent 3's review of OpenInterviewer (MIT), recorded in `docs/adr/0002-openinterviewer-review.md`.

### 8.1 Scoping agent (researcher side)
- Inputs are the chat history and the current brief object.
- Outputs are the next chat message plus a structured brief patch validated by the `BriefPatch` schema. The agent never outputs prices.
- Order of questions is decision, hypotheses, must-have and nice-to-have criteria (written as behavior in a time window), exclusions, number of completes, stimulus, deadline.
- One question per message, under 80 words, with 2 to 4 quick replies including "Something else".
- Pushes back on sizing goals with a plain explanation.
- Drafts the interview guide when the brief is complete. The guide has 6 to 8 core questions, open-ended, non-leading, about the respondent's own past behavior.

### 8.2 Interviewer agent (respondent side)
- Triggered when an answer transcript lands.
- Decides `probe` or `next`. Maximum 2 probes per core question. Total interview time stays under 15 minutes.
- Probes are about the respondent's own experience ("What made you pick that app?"), never leading, never revealing the client, never answering questions outside the interview.
- Re-asks one profile fact once per interview as a consistency check.
- Latency budget p95 under 6 seconds from upload complete to probe shown, including transcription.

### 8.3 Analyst agent (researcher side)
- Runs when fieldwork completes or the researcher clicks "Analyze now" after at least 10 completes.
- Map step codes each redacted transcript against the brief's hypotheses. Reduce step clusters codes into themes.
- Each theme has a one-sentence claim, the count of respondents, confidence (High when 60%+ of respondents and consistent, Medium when 30 to 60%, Low otherwise), up to 10 supporting quote references and contradicting quotes.
- Every quote in the report must resolve to an exact span in the published redacted transcript version for that study. Following OpenVerbatim's grounding approach, each proposed quote carries its source location, rationale and confidence, and a grounding check drops fabricated or unlocatable quotes before they reach a finding. Every accept, edit or drop writes an audit event.
- Proposes one follow-up study as a brief draft.

### 8.4 Transcription
- Use the OpenAI primary adapter and Groq Whisper fallback behind `Transcriber`. Verify and pin supported models before enabling live requests. Run a real-provider check on synthetic audio at Gate 1.
- Send consented audio for transcription after private upload confirmation. Store provider, model, latency and cost per transcript. Keep raw transcripts restricted and publish the redacted version only after the redaction checks pass.
- Typed answers skip speech recognition and use the same redaction and publication rules. Gate 2 reuses the approved transcription path for spoken screening answers and live interview probes.

### 8.5 LLM-assisted confirming screening
- Platform matching first applies eligibility, quotas and cooldowns. When a behavioral criterion needs confirmation, the researcher approves the criterion and question in the brief before fielding.
- Agent 3 interprets one typed answer or consented speech transcript at a time against the approved criterion. The model returns `supported`, `contradicted` or `unclear` with a supporting span when available. Validate both the output schema and the source span. Do not send contact details or full profiles to the model.
- Agent 1 maps valid evidence to the versioned screening rule. Missing evidence, unclear or timed-out model output and invalid output go to an approved clarification or review. They cannot exclude a respondent on their own. Save only confirmed profile facts and keep raw answers restricted.
- Run fixture and held-out evaluations in Gate 2 before using the model in a live study. The acceptance criteria are in BUILD_PLAN sections 6 and 7.

## 9. Trust and privacy

- Respondent promise "Researchers never get your name, phone number or contact details, and we remove personal details from transcripts. If you choose to share your voice, someone may recognize it." Never say "anonymous".
- Respondent login emails are held in restricted Supabase Auth. Researcher-facing queries and views exclude respondent contact data by construction, with private records protected by schema and access policies.
- Consent text is versioned and every consent record stores the version.
- Counsel review is required before public launch for voice consent (Illinois BIPA and similar), international student incentive eligibility, and Harvard and MIT recruiting rules. Track in section 16.

## 10. Domain model and state machines

### Entities
`organization`, `researcher`, `respondent`, `respondent_pii` (restricted private records), `profile_attribute`, `consent`, `study`, `brief_version`, `criterion`, `guide_question`, `pricing_config`, `quote`, `payment`, `invite`, `screener_answer`, `session`, `answer`, `audio_object`, `transcript`, `probe`, `quality_score`, `removal`, `payout`, `points_entry`, `referral`, `report`, `finding`, `evidence_quote`, `push_subscription`, `whatsapp_waitlist`, `audit_log`, `event`.

### Study states
`draft` → `scoping` → `brief_ready` → `awaiting_payment` → `fielding` → `fieldwork_complete` → `analyzing` → `report_ready` → `closed`. Side states `paused` and `cancelled` (refund rules in section 16).

### Invite states
`matched` → `screening` (optional) → `invited` → `accepted` | `declined` | `expired` | `screened_out`.

### Session states
`started` → `in_progress` → `submitted` → `quality_hold` → `approved` | `removed`. `approved` → `paid`. `in_progress` → `abandoned` at 24h expiry.

### Payout states
`pending` → `ordered` → `delivered` | `failed`. `failed` → `ordered` on retry with the same idempotency key.

## 11. Pricing

**Decided 2026-11-19.** Researchers pay **$1 per core question per respondent**. A 5-question study answered by 1 respondent costs $5. A 7-question study with 20 respondents costs $140. Live follow-up probes are included and never billed. Screener questions are not billed.

| Parameter | Value | Notes |
| --- | --- | --- |
| Unit price | 100 cents per core question per respondent | Decided. Stored in `pricing_configs` so it can change without a deploy |
| Billed questions | Core guide questions only | Probes and screeners free |
| Question limit | 4 to 10 core questions | Keeps interviews under 15 minutes |
| Minimum study | Open (Q-01b) | Suggested 5 respondents |
| Respondent incentive | Open (Q-01). Placeholder 40 cents per core question | See economics below |
| Design partner pricing | Same unit price, `pricing_override_id` available for credits | |

**Economics warning.** At $1 per question, a 7-question interview earns $7. Recruiting a new respondent costs roughly $25, spread over about 4 completes, so about $6 per complete early on. Paying respondents $0.70 per minute as originally planned loses about $8 per complete. Paying 40 cents per question ($2.80 for a 7-question interview, about $17 an hour) still loses about $3.50 per complete early and earns about 10% margin once the panel is mature and recruiting cost falls near $2 per complete. Track `margin_per_complete_cents` from day one (section 12).

## 12. Success metrics and events

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

## 13. Design guidelines

Use the versioned [design system](design-system/README.md) and [UI resource registry](UI_RESOURCES.md). Agent 2 maintains the generated UI tokens with the repository drift check. Use the versioned design system when a token or component detail differs from the guidelines below.

### 13.1 Principles
1. **Voice first.** The record action is the biggest, most pressable thing on any respondent screen. Typing is always available, never the default.
2. **One loud thing per view.** Either the Echo or one `pulse` fill, never both. Everything else is `ink` on `fog` and `paper`.
3. **Money is lime.** `zest` means earnings and nothing else.
4. **Show the work.** Researchers see counts, quotes and quality scores behind every claim. No decorative charts.
5. **Playful in copy and motion, calm in layout.** Left-aligned, generous space, no grids of identical cards.

### 13.2 Color

Light theme is the default. Dark theme is supported in both apps via `data-theme`.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `fog` | #F3F2F7 | #121019 | Page background |
| `paper` | #FBFBFD | #1C1925 | Cards, sheets, composer, brief panel |
| `paper-sunk` | #ECEAF2 | #0D0B12 | Wells inside cards (quotes, transcript strips) |
| `line` | #E2E0EA | #2E2A3A | Hairline dividers, decorative only |
| `line-strong` | #8E8A9E | #6E6A80 | Input and control borders (3:1) |
| `ink` | #17151F | #F3F1F8 | Primary text, primary button fill |
| `ink-muted` | #5D5A6B | #A7A3B6 | Secondary text, captions, placeholders |
| `on-ink` | #FBFBFD | #121019 | Text on an ink fill |
| `pulse` | #FF4F8B | #FF6B9E | The Envoi pink. The Echo and the one key action. Never text |
| `pulse-edge` | #C21E5B | #FF8AB3 | Pink as text or a 1px edge, links, the border on pulse fills |
| `on-pulse` | #17151F | #121019 | Text on pulse fills. Never white |
| `pulse-wash` | #FFE3EC | #3A1B2A | Selected options, recording state ground |
| `zest` | #D4F55A | #D4F55A | Money only. Earnings chip, receipts, points |
| `zest-deep` | #4A6600 | #D4F55A | Dollar amounts as text |
| `zest-wash` | #EEF9C7 | #2C3312 | Payout receipt ground |
| `tide` | #3A5BFF | #8FA2FF | Researcher data, segment tags, report links |
| `good` | #1E7F4F | #5FD49A | Passed, filled. Always with a word or icon |
| `warn` | #A85D00 | #F2A93B | Expiring, slow fill, review. Always with a word or icon |
| `critical` | #C2283E | #FF7A8A | Removed, failed, errors. Always with a word or icon |
| `focus` | #C21E5B | #FF8AB3 | 2px focus ring, 2px offset, on every interactive element |

### 13.3 Typography

One family, **Manrope** (Google Fonts, weights 400 to 800, loaded with `next/font`). Elegance comes from tight tracking and weight contrast, not a second face. Use tabular numbers for money and counts, and `text-wrap: balance` on headings.

| Style | Size / line height | Weight | Tracking | Use |
| --- | --- | --- | --- | --- |
| `display-xl` | 64 / 60 | 700 | -0.045em | One per page. Welcome, payout moment |
| `display-l` | 40 / 42 (32 / 38 on phones) | 700 | -0.035em | The interview question |
| `h1` | 30 / 36 | 700 | -0.03em | Researcher page titles |
| `h2` | 22 / 28 | 650 | -0.02em | Section and theme titles |
| `stat` | 36 / 40 | 700 | -0.03em | Counts and totals |
| `h3` | 17 / 24 | 600 | 0 | Card titles |
| `body-l` | 18 / 28 | 400 | 0 | Respondent body copy, agent messages on mobile |
| `body` | 16 / 24 | 400 | 0 | Default text. Inputs are 16px so iOS never zooms |
| `body-s` | 14 / 20 | 400 | 0 | Supporting text, table cells |
| `label` | 13 / 16 | 600 | 0 | Chips, dense buttons. Sentence case, never all caps |
| `caption` | 12 / 16 | 500 | 0 | Timestamps, footnotes |

### 13.4 Spacing, shape and depth
- **Spacing** on a 4px base. `space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16, `space-6` 24, `space-8` 32, `space-12` 48, `space-16` 64. Mobile gutters 16, desktop 24.
- **Radius.** `radius-sm` 10 for inputs, `radius-md` 16 for cards, `radius-lg` 28 for sheets, the invite card and the interview stage, `radius-pill` for buttons and chips.
- **Depth.** Flat cards with a `line` edge by default. `shadow-card` only for floating things (invite card, brief panel, sheets). `shadow-press` on primary and pulse buttons. No glass, no glow.

### 13.5 The Echo (3D voice orb)
A WebGL sphere with a noise-displaced surface, lit like glossy plastic. Pulse body, peach highlight, cool lilac rim. One per view, always pulse (zest only during the payout flash).

| State | Where | Behavior |
| --- | --- | --- |
| `idle` | Interview screen, ready | Slow breathing, 6s loop |
| `listen` | While recording | Ripples driven by mic level, scales to 1.06 |
| `think` | Agent writing a follow-up, researcher agent avatar | Faster, tighter wobble |
| `sent` | Answer saved | Settles back to round over 320ms |
| `payout` | Receipt screen | Flashes zest once, then settles |

API `EchoProps { state, size, level?: () => number }`. Wrap it in a `<button aria-pressed>` when it records. Pause rendering off-screen or in a hidden tab. One still frame under `prefers-reduced-motion`. Flat pulse disc when WebGL is missing. Lazy-load its chunk.

### 13.6 Components

| Component | Used in | Key rules |
| --- | --- | --- |
| Button | Both | Primary (`ink`), pulse (respondent go action, max one per view), secondary, ghost. 44px tall, 36px small. Verb first, no arrows in labels |
| EarningsChip and ProgressTrack | Respondent | Reward top right in `zest`, progress top left with "3 of 7" text |
| StatusChip | Both | Word plus icon. Color only in the icon |
| InviteCard | Respondent | Time left, topic, reward, minutes, questions, why you, privacy line, two actions, in that order |
| VoiceAnswer | Respondent | Answer bubble with play and waveform, follow-up with small Echo, live recording row as a status region |
| AgentChat | Researcher | One question per message under 80 words, quick-reply chips with "Something else", caption saying what changed in the brief |
| StudyBrief | Researcher | Every section visible as a placeholder from the start. Quote shows line items and feasibility. Approve button repeats the amount |
| FillTracker | Researcher | Completes against target as "14 of 20", one scale for all bars, removals always visible |
| FindingCard | Researcher | Claim as a sentence, dot strip plus "11 of 20 said this", confidence chip, one grounded lead quote |

Two example screens in the design system show how these combine (respondent interview on mobile, researcher scoping on desktop).

### 13.7 Layout
- **Respondent.** Phone first at 360 to 430px. Full height with `100dvh` and safe areas. One question per screen, left-aligned, Echo in the bottom third within thumb reach. Keep the primary action visible at 667px height. Allow scrolling when content, text size or the keyboard requires it.
- **Researcher.** Desktop first at 1280px, works at 1024px. Three columns for scoping (232px study rail, chat column with 620px reading width, 440px brief panel). Under 900px the brief becomes a sheet. Reports read top to bottom, answer first.

### 13.8 Motion
- Enter and exit `cubic-bezier(0.23, 1, 0.32, 1)`. Moving on screen `cubic-bezier(0.77, 0, 0.175, 1)`. Sheets `cubic-bezier(0.32, 0.72, 0, 1)`.
- 140ms presses (`scale(0.97)`), 200ms most UI, 320ms sheets and the next question sliding in. Nothing interactive over 400ms.
- Animate only transform and opacity. Hover effects only on devices with a fine pointer.
- The payout moment is the one celebration. No confetti.
- Under reduced motion keep opacity and color changes, drop movement.

### 13.9 Voice and copy
- Warm, direct and a little playful with respondents. Plain and exact with researchers. Second person.
- Sentence case everywhere. No em dashes. No exclamation marks except the payout moment. No emoji in the UI.
- Use concrete estimates and the study’s approved reward.
- Say "interview", not "survey", in user-facing copy.
- All strings live in `copy.ts` per route so a rename is a one-file change.
- Examples. Record prompt "Tap and talk like you'd tell a friend". Error "We couldn't hear that one. Tap to try again, or type instead." Feasibility "We expect 18 of your 20 in 48 hours." Label "Directional qualitative".

### 13.10 Iconography and brand
- Phosphor Icons, Regular at 20px in UI, Bold at 24px on respondent record controls. Stroke icons in `ink` or `ink-muted`. No decorative icons above headings.
- No logo yet. Set the name in Manrope 700 with -0.045em tracking in `ink`.

### 13.11 Accessibility
- WCAG 2.1 AA in both themes. Text pairs meet 4.5:1, control borders and focus rings 3:1.
- Status never relies on color alone. `good` and `critical` also differ in lightness.
- Touch targets 44px minimum, the record button 96px or larger.
- Voice is never the only way in. Every question accepts typed answers.
- Live regions announce "Recording", "Saved" and new agent messages.
- axe checks on every main screen with zero serious or critical issues (Gate 3).

### 13.12 Don't
- Purple to blue gradients, gradient text, glass cards, colored left-border cards.
- Monospace labels, all-caps eyebrows, centered blocks of body text.
- `pulse` on headings or long text, `zest` for anything but money.
- More than one Echo or more than one pulse action on a screen.

## 14. Open-source building blocks

We reuse proven open-source work for commodity parts and write our own code for what makes the business defensible. BUILD_PLAN section 11 has the step-by-step instructions and license rules.

### 14.1 What we build on

| Project | License | What it gives us | How we use it | Owner | When |
| --- | --- | --- | --- | --- | --- |
| [OpenInterviewer](https://github.com/linxule/openinterviewer) | MIT | Adaptive AI interviews with follow-ups, consent recording, voice input, save-first transcripts, per-interview and cross-study synthesis, follow-up study generation, Q&A over transcripts with located quotes | **Study, then borrow.** Agent 3 reviews its interview loop, follow-up prompts and synthesis before writing the interviewer and analyst, and records decisions in `docs/adr/0002-openinterviewer-review.md`. Record which patterns to adopt or skip. Before copying any code, follow the pinning, notice and test steps in BUILD_PLAN section 11 | Agent 3 | Before live interviewer implementation |
| [OpenVerbatim](https://github.com/Vellum-Works/openverbatim) | Apache-2.0 | Transcript coding into themes with cited answers, a grounding check that drops fabricated or unlocatable quotes, append-only audit trail, consent-withdrawal deletion | **Copy the approach** for report quotes (R-RSCH-08, section 8.3). Each proposed quote carries its location, rationale and confidence, and is dropped if it is not an exact span | Agent 3 | Gate 3, week 6 |
| [Presidio](https://github.com/data-privacy-stack/presidio) | MIT | Detection and anonymization of personal data (phones, emails, addresses, names) | **Evaluate as a private service.** Benchmark analyzer and anonymizer as the first pass for R-PLAT-07. Document an alternative in an ADR if acceptance fails | Agents 3 and 1 | Gate 1 before researcher transcript publication |

### 14.2 Useful references (read, do not depend on)

| Project | License | Why it is useful |
| --- | --- | --- |
| [Primary Market Research Agent](https://github.com/bag-federico/PrimaryMarketResearchAgent) | MIT | Voice and WhatsApp interviews with topic coverage scoring and agreement and disagreement clustering. Reference for the v1.1 WhatsApp channel and probe logic. Solo personal project in Python |
| [FoloUp](https://github.com/FoloUp/FoloUp) | MIT | AI voice interviewer for hiring on Next.js and Supabase, our stack. Scaffold reference |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) and [WhisperX](https://github.com/m-bain/whisperX) | MIT, BSD | Self-hosted transcription if hosted transcription gets expensive at volume |
| [Pipecat](https://github.com/pipecat-ai/pipecat) and [LiveKit Agents](https://github.com/livekit/agents) | BSD, Apache-2.0 | Real-time voice agent frameworks, only if we move from recorded answers to live voice conversations |

### 14.3 Do not copy

| Project | License | Rule |
| --- | --- | --- |
| [OASIS](https://github.com/oasis-surveys/oasis-platform) | AGPL-3.0 | Read for ideas only. Copying its code into a hosted service would oblige us to publish our source |
| [Formbricks](https://github.com/formbricks/formbricks), [LimeSurvey](https://github.com/LimeSurvey/LimeSurvey) | Copyleft or mixed | Form builders, not a fit for voice-first interviews. Do not copy code |

### 14.4 What stays ours
The respondent panel, matching, quality scoring, fraud controls, payouts, points and pricing are written in-house with no third-party code in those areas. Keep the corresponding policy and domain logic in Envoi Labs.

### 14.5 License rules
- MIT, Apache-2.0 and BSD code may be reused. Keep the original copyright and license in the file header and add an entry to `THIRD_PARTY_NOTICES.md` in the same PR. For Apache-2.0, carry its NOTICE contents and mark the file as modified.
- Never copy AGPL or GPL code.
- Reused code gets its own tests in our repo.

## 15. Release plan

| Gate | Target | Meaning |
| --- | --- | --- |
| Gate 0 | End of week 1 | Foundations ready |
| Gate 1 | End of week 3 | Vertical slice, one study end to end with seeded data |
| Gate 2 | End of week 5 | Money loop and scoping, first real study with hand-recruited respondents |
| Gate 3 | End of week 7 | Probing, reports, quality, pilot with 30 to 50 respondents and 2 to 3 founders |
| Gate 4 | End of week 8 | Launch hardening |

See [BUILD_PLAN section 6](BUILD_PLAN.md#6-stage-gates) for acceptance and pre-study prerequisites. Week numbers are planning targets.

## 16. Open questions

| ID | Question | Raised by | Proposed answer | Decision |
| --- | --- | --- | --- | --- |
| Q-01 | Respondent incentive per core question given the $1 price (30 or 40 cents), and whether to add a per-study platform fee or bill probes to reach positive margin | Claude | 40 cents, review after pilot margin data | Open |
| Q-01b | Minimum respondents per study | Claude | 5 | Open |
| Q-02 | How to reach iPhone respondents who never install the PWA | Claude | Use in-app install guidance after the first payout. Revisit optional SMS nudges after v1. | Deferred |
| Q-03 | Where the first 100 respondents come from beyond MIT and Harvard | Council | Campus ambassadors plus $3k ads test | Open |
| Q-04 | Can international students on study visas accept paid incentives | Claude | Counsel review before launch | Open |
| Q-05 | Harvard and MIT rules for recruiting students into paid commercial studies | Claude | Counsel review before launch | Open |
| Q-06 | Voice consent and retention under BIPA and similar | Council | Counsel review before launch | Open |
| Q-07 | Add Tremendous prepaid Visa to the catalog | Claude | Yes if fees stay at zero | Open |
| Q-08 | Refund policy when a study cannot fill | Claude | Pro-rata refund of unfilled completes | Open |
| Q-09 | Final product name | Rachel | Envoi Labs | Decided |

## 17. Changelog

| Date | Who | Change |
| --- | --- | --- |
| 2026-11-19 | Claude | Initial PRD from notes, council review and decisions log |
| 2026-11-19 | Rachel via Claude | Pricing set to $1 per core question per respondent. Section 10 rewritten, R-PLAT-01 updated, Q-01 reframed as incentive and margin question |
| 2026-11-20 | Rachel via Claude | Build plan adds open-source references (OpenInterviewer, OpenVerbatim, Presidio). Redaction uses Presidio first. Panel, matching, quality, payouts and pricing stay proprietary |
| 2026-11-20 | Rachel via Claude | Synced PRD with the build plan. Added the change summary, proprietary-core and reuse decisions, redaction and quote guidance, and the price example |
| 2026-11-20 | Rachel via Claude | Added section 6 user journeys (notes-to-v1 map, respondent and researcher journeys with edge cases and metrics, where AI is used), section 13 design guidelines (tokens, type, Echo, components, layout, motion, copy, accessibility) and section 14 open-source building blocks. Renumbered sections 6 onward and updated references in all docs |
| 2026-11-20 | Envoi Labs | Incorporated the revised kit’s journeys, design and upstream evaluations while preserving live status, Envoi Labs naming and the audited release prerequisites. |
| 2026-11-21 | Envoi Labs | Added the confirming screener AI specification and mapped both UI journeys, voice transcription and upstream evaluation to gate acceptance. |
| 2026-11-21 | Rachel via Codex | Clarified the persistent respondent account, eligible studies on Home and gift card management in Earnings. |
| 2026-11-21 | Rachel via Codex | Switched respondent account sign-in to a one-time email link. Mapped email delivery, verified identity and the 18+ check to Gate 0. |
