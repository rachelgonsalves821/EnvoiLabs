# Envoi Labs respondent and researcher terms (proposed draft v0.2)

| Field | Value |
| --- | --- |
| Owner | Rachel |
| Status | Proposed copy for Rachel and counsel review. Not approved for enrollment or publication |
| Date | 2026-11-24 |
| Covers | Proposed Gate 2 marketplace and money terms plus unresolved voice/data consent. PRD Q-01, Q-01b, Q-06, Q-07, Q-08, Q-10 and Q-11 |
| Brand | Envoi Labs. `[Company]` is the legal entity name and remains to be supplied |

This is a working draft, not legal advice. Product economics below reflect Rachel's 2026-11-24 direction; the privacy, voice, biometric, retention, tax, fees, dispute and vendor claims inherited from v0.1 remain **unverified proposals**. Bracketed items need a fact or decision. No text here grants consent or enables live enrollment, voice use, AI follow-ups, payments or payouts. The existing app still uses preview consent and profile-before-consent; the proposed screen order below is not implemented.

**Implementation check.** Current respondent signup sends a same-browser email sign-in link and records an 18+ attestation. Researcher sign-in also uses email plus TOTP. The current respondent onboarding saves the profile before preview consent. There is no current Twilio/phone-code sign-in flow in these app paths; legacy phone fields remain in the database and need a separate data-handling audit. No public notice should claim phone verification, consent-first onboarding, or approved LLM processing based on this draft.

---

## 0. Decisions to approve

| ID | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| Q-06 | Voice consent and biometric treatment | [Rachel/counsel to approve exact release, classification, locations and wording] | The v0.1 legal analysis is unverified; no live voice collection on this draft |
| Q-06 | Voiceprints and liveness | [Confirm actual processing and whether any speaker feature is created] | Do not promise a technical exclusion without implementation evidence |
| Q-06 | Retention | [Approve each data class and actual deletion path] | The v0.1 60-day/24-month proposal is not approved policy |
| Q-06 | Voice clips | Off for the first marketplace test; [approve any later per-study sharing and deletion behavior] | No live researcher voice publication |
| Q-01 | Researcher price and respondent reward | Charge $2 per core question per respondent; reward $1 per answered core question under the approved quality rule | The $1 difference is gross spread before provider fees, referral, fraud and operating costs. Probes and screeners are not billable core questions |
| Q-01b | Minimum study size | 10 respondents | The quote and checkout must reject fewer than 10 |
| Q-08 | Unfilled studies | At study close, refund each respondent slot that did not complete at that slot's original frozen quote price | Twelve paid slots and eleven completes refund one slot; the completion snapshot, close trigger and provider timing still need approval and implementation |
| Q-08 | When a study closes | [Rachel to approve exact close/fill cutoff and handling of disputed or later completes] | The v0.1 seven-day and researcher-stop proposal is not settled policy |
| Q-07 | Prepaid Visa at launch | Prepaid Visa is the v1 respondent reward method | Verify the actual product, sender/recipient fees, delivery, limits and disclosures before public copy or live use |
| Q-10 | Referral reward | $5 after five distinct referred friends have verified profiles | Profile-verification event, duplicate/self-referral checks, reversal and payout ledger need implementation review |
| Q-11 | Enrollment | Open self-service signup, profile and eligibility-based matching | There is no selected invite cohort or hand-recruited first study |
| New | Consent order | [Approve purpose-specific consent before any voice recording] | Current profile-before-consent implementation must change for voice use |
| New | Researcher access | [Approve required qualified redacted output use and actual withdrawal behavior] | Consent and export enforcement require testing |
| New | Disputes | [Counsel to draft any dispute process] | No arbitration or class-waiver term is approved |
| New | AI data use | [Verify provider controls, training and secondary-use settings before drafting a promise] | A distinct approved AI follow-up purpose is required; live probes remain off |

---

## 1. Source material requiring verification

The v0.1 source draft collected leads on biometric and privacy law, tax reporting, refund fees, prepaid card products and competitors' terms. Those leads are **not adopted as legal findings or product promises** here. Rachel/counsel must verify applicable law, actual data processing, tax treatment, provider agreements and fees before approving notices or terms. The source links below are research leads, not proof of an approved policy. The confirmed product decisions for this proposed revision are the marketplace economics in section 0; implementation still has to meet the requirements in section 8.

---

## 2. Respondent consent screen (proposed copy, not enabled)

Proposed placement is after the verified email sign-in link and before any voice-enabled profile question. Current onboarding presents profile first, so this order requires a separate implementation and consent review. Store each approved purpose with its exact `text_version`; the copy, provider list, retention schedule and recording release still need Rachel/counsel approval.

> **Before your first interview**
>
> Here's how interviews work and what happens to your answers.
>
> **Choose how to answer.** You may type. If you choose to record, we send your recording to an approved transcription provider after you agree to the recording and transcription purposes described in the full notice.
>
> **Researcher report and analysis.** [Describe the reviewed, redacted text and any AI-assisted report analysis, its provider, data sent, retention and human review after Rachel/counsel approval. Verify exact redaction and export behavior before publication.]
>
> **How long we keep answers.** [Insert the approved, implemented retention and deletion schedule.]
>
> **Voice and AI.** [Insert counsel-reviewed voice/biometric notice and verified provider data-use commitments.]
>
> [Toggle, off, proposed only] **Let researchers hear short clips of my voice.** We'll ask you again for each study. Someone who knows you could recognize your voice. Keep this feature off for the first marketplace test.
>
> [Separate toggle, off, proposed only] **Let an AI service read my reviewed interview text to suggest follow-up questions.** [Identify the exact provider, data sent and retention terms in approved copy.] If you do not agree, the interview uses the next planned question. This purpose is `ai_followup` and must never be inferred from recording, transcription or researcher-access consent.

> [Separate toggle, off, proposed only] **Let reviewed, redacted answers be used to test and improve future interview questions.** [Specify scope, provider, data sent and retention after approval.] This optional `question_improvement` purpose is independent of report analysis and follow-up questions.
>
> [Checkbox, unchecked, draft] I have read the [Respondent Privacy and Recording Notice] and [Respondent Terms]. [Counsel to approve the exact required recording release and separate optional purposes.]
>
> [Button] Agree and continue

Proposed rows: `retention` and `researcher_access` as approved prerequisites for taking part; `recording` and `transcription_vendor` only when voice is chosen under approved copy; `voice_clip_sharing` only by separate per-study opt-in; `report_analysis` under an approved report purpose; and `ai_followup` and `question_improvement` only by their own distinct, versioned opt-ins. No purpose is inferred from another. Store the grant's actor, study scope where applicable, text version and digest, purpose, choice and timestamp; bind provider identity and exact data categories to the approved text. Recheck the current receipt before processing. The current preview screen has only four purposes and does not implement this complete flow. Live voice sharing and LLM follow-up stay disabled pending approval and enforcement tests.

---

## 3. Respondent Privacy and Recording Notice (proposed outline, not public copy)

**Version** [approved version] **Effective** [approved date] **Legal entity** [Company]. The v0.1 legal research and proposed biometric release are source material for counsel, not verified legal conclusions or approved notice text. Counsel and Platform must reconcile this outline with the actual app, provider settings and deletion jobs before any respondent sees it.

### 3.1 Data to disclose and verify

- **Account and profile.** Current signup uses a verified email sign-in link and 18+ attestation; the profile stores answers used for eligibility and matching. The database also has legacy phone fields, whose collection, access and retention need a separate audit. Do not claim current phone verification or Twilio sign-in.
- **Answers.** Typed answers, optional voice recordings, private raw transcript, reviewed redacted transcript, answer timing, screening decisions and quality signals. Voice collection and sharing require their own approved purpose and tested path.
- **Payments and referrals.** Approved per-question rewards, prepaid Visa delivery status, referral attribution and verified-profile count, and any records actually required for tax/accounting. Exact provider and recipient data are pending verification.
- **Researcher outputs.** Qualified redacted transcripts, findings, quotes and exports only under current consent and source-version checks. Verify withdrawal/deletion behavior across existing exports before making a public promise.

### 3.2 Processing purposes and choices

Account operation, profile-based matching, restricted screening, quality/fraud review and payout each need exact disclosure. `recording` and `transcription_vendor` apply only to voice answers. `researcher_access` concerns qualified redacted text. `report_analysis` needs its own approved disclosure of any model or processor use for a researcher report. `voice_clip_sharing` is separate per study and stays off for the first marketplace test. **`ai_followup` is a separate, proposed, versioned opt-in for sending reviewed interview text to an approved LLM to suggest a probe. `question_improvement` is another optional, separate proposed purpose. Neither is granted by recording, transcription, report analysis or researcher-access consent. Live follow-ups remain disabled until Rachel/counsel approve the actual copy, provider and data flow and the app enforces it.** Secondary model evaluation or training is not authorized by this draft.

### 3.3 Voice and biometric notice [counsel and implementation hold]

Counsel must supply the applicable release, collection purpose, processor disclosure, withdrawal effect and retention schedule. Platform must verify whether any voiceprint, speaker feature or biometric template is created; v1 plans only word comparison for liveness and file-hash duplicate checks. No unverified claim that the service is outside a biometric law or that a checkbox alone satisfies a particular law should be used as public copy.

### 3.4 Retention, deletion and exports [policy and implementation hold]

| Data | Approved period and trigger | Implementation evidence needed |
| --- | --- | --- |
| Raw voice and private transcript | [Counsel/Rachel to approve] | Storage, queue, backup and worker deletion tests |
| Redacted transcript, report and export | [Counsel/Rachel to approve] | Current consent/source checks and deletion regression |
| Account/profile and legacy phone fields | [Counsel/Rachel to approve] | Actual collection, access and deletion audit |
| Payout, referral, consent and tax records | [Counsel/Rachel to approve] | Provider, ledger and legal retention review |

The 60-day, 24-month, 7-year and other periods in v0.1 are proposals only. The right to delete and any records retained by law need counsel-approved language matched to tested behavior.

### 3.5 Providers and data transfers [configuration hold]

Current source uses Supabase Auth email links, Supabase storage/database and Vercel hosting. The interview and analysis plans mention transcription and LLM adapters, payout delivery, jobs, push and monitoring. An adapter does not prove live provider settings or contracts. Before public copy, list only the actual enabled providers and what each receives; verify location, contracts, training/use controls, retention settings, recipient fees and fallback behavior. The v0.1 Twilio phone-code entry does not match current sign-in. Prepaid Visa is the v1 reward decision, but its provider product and fee/recipient terms are not verified. Do not promise zero retention, zero fees or a particular DPA without evidence.

### 3.6 Controls and contact [implementation hold]

Proposed controls include stopping invites, study withdrawal, voice sharing choices, data access and deletion. No retention purge or deletion-request job was found in the current app, and there is no researcher clip stream. Confirm implementation and the effect on raw storage, qualified researcher views and exports before publication. Use [privacy contact], [support contact] and [legal entity] only after Rachel supplies them.

---
## 4. Per-study prompts

**Matched study offer card privacy line (R-RESP-04; proposed, pending enforcement review)**
> Researchers receive qualified redacted answers under the approved sharing settings. [Verify which profile or contact details, if any, are visible to a researcher before approving this line.]

**Voice clip opt-in (proposed for a future approved study; disabled for the first marketplace test)**
> **Share voice clips for this study?**
> The researcher could hear short clips of your answers. Someone who knows you could recognize your voice. You'll be paid the same either way.
> [Keep my voice private] [Share clips]

If approved and implemented, write `voice_clip_sharing` with `study_id`. Default is private; no current sharing claim is approved.

**Liveness check (R-PLAT-06; proposed, verify actual implementation and consent)**
> **Read this out loud: "blue river seven lamp"**
> [Explain the actual check, data sent and retention after implementation review.]

---

## 5. Respondent compensation terms (proposed copy)

Part of the future Respondent Terms, version [approved version]. These terms are not displayed or accepted by the current app.

1. **Joining.** You must be 18 or older and use your own verified email account. [Rachel/counsel to approve geographic eligibility, duplicate-account handling and exact signup acceptance copy.] Open self-service signup and a verified profile may make you eligible for matching; we do not promise an invite.
2. **Interview reward.** The proposed reward is **$1 for each answered core interview question** that qualifies under the approved quality policy. Follow-up probes are included and do not add reward. A screener reward, if any, must be shown separately before the screener. [Define what counts as an answered question after a partial, abandoned, expired, removed or disputed session before publishing this promise.]
3. **Review and timing.** Your receipt shows a pending amount and quality status. [Approve the hold, review, appeal, finalization and delivery timing against the actual service before public copy.]
4. **How you are paid.** Prepaid Visa is the v1 reward method. [Verify the provider's actual product, eligibility, delivery route, fees, limits, expiry and recipient disclosure before offering it.] The payout ledger must prevent duplicate orders and respect the approved annual cap.
5. **Referral reward.** A unique referral link may earn **$5 after five distinct friends you referred have verified profiles**. [Define profile verification, identity deduplication, self-referral, fraud review, reversal and delivery timing.] A sign-up or unverified profile does not vest the bonus. One threshold award is recorded once.
6. **Points and bonuses.** [Reconcile any points, streak and milestone promises with the $1 per answered question and referral ledger. They are not approved payout terms in this draft.]
7. **Taxes, caps, account closure and disputes.** [Counsel and provider to supply exact terms and thresholds. Do not adopt the v0.1 tax, $1,950 cap, liability or arbitration language without review.]

---

## 6. Researcher study and refund terms (proposed copy)

Part of the future Researcher Terms, version [approved version]. The quote and checkout must show the actual frozen values and approved terms version before payment.

### 6.1 Quote summary (proposed quote panel)

> **5 core questions × 12 respondents × $2 = $120.** At least 10 respondents per study. Follow-up probes and screeners are not billed. If 11 of these 12 respondent slots complete by the approved study close, one uncompleted slot is refunded at its frozen $10 price, so the refund is **$10**. [Insert approved close and refund timing.]

The $2 charge and $1 respondent reward create a $1-per-question gross spread before payment fees, prepaid Visa/order fees, referrals, processing, acquisition, fraud and support. The quote must not suggest that this is net margin.

### 6.2 Price and payment

1. A study quote is core questions × target respondents × **$2**, with at least **10 respondents** and 4 to 10 core questions. Follow-up probes and screeners are not billed.
2. The approved guide, target, brief and pricing configuration version are frozen into the quote. A later price change does not rewrite a paid quote.
3. Checkout shows the full frozen amount. The study launches only after the provider payment is verified against that quote and study. [Confirm payment method and final checkout acceptance copy.]

### 6.3 Completion and quality [operational definition pending]

The unfilled-slot refund uses the count of qualifying completed respondent slots at the approved close snapshot. The v0.1 proposal requires all core answers plus quality approval. Rachel/counsel and Platform must agree how partial answers, later quality reversals, withdrawal and disputed completes affect that count. Respondent per-answered-question rewards are a separate ledger and do not change the researcher's frozen per-slot price.

### 6.4 Refunds for unfilled respondent slots

1. **Amount.** For each paid respondent slot that did not complete, refund one slot at the original frozen quote's core-question charge. Compute `(paid slots − qualifying completed slots) × frozen core questions × frozen unit price`, never using a later price.
2. **Example.** A five-question, 12-slot study costs $120. If 11 slots complete, refund one slot × 5 questions × $2 = **$10**. Eleven completed slots remain charged at their frozen price.
3. **Close and delivery.** [Approve the fill cutoff, researcher stop, pending/disputed completes, refund initiation time, destination, provider fees and late corrections.] The v0.1 seven-day and five-business-day statements are not settled.
4. **Evidence and retries.** One immutable completion snapshot and refund key must prevent a replay or webhook retry from refunding the same missing slot twice. Record provider observations separately from respondent rewards and payouts.

### 6.5 Feasibility and data use [review pending]

Feasibility comes from actual eligible active marketplace profiles and observed accept/completion rates. Where there is too little data, say so instead of promising a fill time. Researchers receive only qualified redacted outputs under current consent and source checks. [Counsel to approve use, export, liability, dispute and privacy restrictions; Gate 3 must verify the actual report/export behavior.]

---

## 7. Where and when proposed terms would appear

These placements are design requirements, not claims that the current app has implemented or that counsel has approved them. Record the exact accepted text version, actor and timestamp when each flow is built.

### 7.1 Respondent

| Journey stage | Proposed notice/action | Current implementation or hold |
| --- | --- | --- |
| Discover | Links to approved terms/privacy notice | Draft only; no enrollment publication |
| Email sign-in | 18+ attestation and link to approved Respondent Terms | Current app uses email link and age attestation; terms acceptance needs implementation review |
| Consent before voice/profile recording | Purpose-specific approved text and unchecked choice; separate `ai_followup` opt-in | Current app saves profile before preview consent; proposed order and LLM purpose are not approved or mounted |
| Matched study offer | Approved reward, privacy line and any screener amount | Open signup creates a profile; eligible profiles may later receive a matched offer. The existing internal code calls an offer an invite, but there is no selected invite-only enrollment cohort. Marketplace rules remain pending |
| Voice sharing | Per-study separate opt-in | Off for first marketplace test; no live voice publication |
| Receipt/Earnings | Pending per-answered-question reward and prepaid Visa status | Provider product and quality timing require verification |
| Referral | Five verified unique profiles and $5 threshold | Ledger and fraud checks not implemented |
| Settings/material change | Withdrawal/deletion and new consent version | Verify actual storage, exports and refresh behavior before promise |

### 7.2 Researcher

| Journey stage | Proposed notice/action | Current implementation or hold |
| --- | --- | --- |
| Email sign-in and MFA | Approved researcher terms and data-use rules | Current app uses email link plus TOTP; terms acceptance flow needs review |
| Quote | Frozen core-question line items, at least 10 respondents, feasibility basis, per-slot refund | Draft Gate 2 quote path; no live payment |
| Checkout | Exact approved terms version beside the frozen amount | Authenticated route, provider and terms record are not mounted |
| Study close | Completed-slot count and frozen-price refund receipt | Close trigger and idempotent refund ledger are not implemented |
| Report/export | Current qualified redacted view and use rules | Gate 3 approval and API/export wiring pending |

---

## 8. Build changes proposed by this draft

| Area | Required change before live use | Review owner |
| --- | --- | --- |
| Auth/profile | Keep email-link signup and 18+ proof; audit legacy phone fields. If voice profile input is enabled, present approved recording consent before mic access | Gate 1, Platform, counsel |
| Consent | Version `recording`, `transcription_vendor`, `retention`, `researcher_access`, `report_analysis`, per-study `voice_clip_sharing`, and distinct `ai_followup` and optional `question_improvement` copy. Bind each grant to its text digest, provider/data disclosure and scope. Deny live LLM probes until approved text and enforcement tests exist | Rachel/counsel, Gate 1, Gate 2, Gate 3 |
| Pricing | Select immutable marketplace config at $2 charge/$1 reward, reject fewer than 10, retain historical quote versions | Gate 2 |
| Refund | Finalize a qualifying-complete snapshot at the approved close event; refund only missing slots at the frozen per-slot price, transactionally and idempotently | Rachel/counsel, Gate 2 |
| Respondent payout | Reward approved answered core questions separately from refunds; verify prepaid Visa catalog, recipient routing, fee disclosure and provider statuses in sandbox | Gate 2, Gate 4 |
| Referral | Count five distinct verified referred profiles, reject duplicate/self-referrals, and reserve one $5 threshold award | Gate 2, Gate 4 |
| Voice, retention and providers | Verify actual voice, redaction, deletion, signed access, processor contracts, data-use settings, tax and fee statements; publish no period or legal claim until approved | Gate 1, Gate 3, Gate 4, counsel |
| First study | Use open self-service profiles and matching after the above gates; no hand-recruited or selected invite cohort | Rachel, coordinator |
## 9. Approval and implementation holds

- Rachel and counsel: legal entity, jurisdiction, dispute terms, voice and biometric classification, signed release, data-purpose copy, retention by data class, withdrawal/export effect, tax and incentive eligibility. The v0.1 BIPA, arbitration, tax-cap and fixed-retention assertions remain unverified.
- Rachel: qualifying-complete definition, partial-session reward rules, close/cutoff time, refund initiation, referral verification/reversal, points or other bonuses and prepaid Visa experience.
- Platform and Gate 1: actual consent order, independent `ai_followup` receipt, legacy phone-field audit, voice/transcript deletion, restricted redacted report/export, current-source check and provider configuration. Live LLM follow-up remains disabled.
- Gate 2: authenticated quote/checkout, frozen quote and refund ledger, payout provider product and recipient fee verification, five-unique-profile referral accounting and synthetic retry tests. No charge, payout, recruitment or publication is authorized by this draft.

---

## Sources

- [Illinois BIPA, 740 ILCS 14](https://ilga.gov/legislation/ilcs/ilcs3.asp?ActID=3004)
- [Greenberg Traurig on the 2024 BIPA amendment](https://www.gtlaw.com/de/insights/2024/8/bipa-update-illinois-limits-liability-and-clarifies-electronic-consent-for-biometric-data-collection)
- [Biometric Update on Delgado v. Meta](https://www.biometricupdate.com/202608/meta-loses-bid-to-end-bipa-voiceprint-suit-as-case-moves-forward)
- [HR Daily Advisor on Delgado v. Meta](https://hrdailyadvisor.hci.org/2026/07/28/voiceprint-you-didnt-mean-to-create-what-delgado-v-meta-means-for-employers/)
- [Lewis Rice on AI transcription and BIPA](https://www.lewisrice.com/publications/ai-transcription-tools-give-rise-to-bipa-claims)
- [Davis Wright Tremaine on Colorado biometrics](https://www.dwt.com/blogs/privacy--security-law-blog/2025/05/colorado-privacy-act-biometrics-updates-july-2025)
- [Biometric Update on Texas and Colorado](https://www.biometricupdate.com/202506/texas-and-colorado-take-diverging-paths-on-biometric-privacy)
- [Koji CCPA guide for user research](https://www.koji.so/docs/ccpa-user-research-compliance)
- [Patriot Software on the $2,000 1099 threshold](https://www.patriotsoftware.com/blog/accounting/1099-reporting-threshold/)
- [Stripe on fees for refunded payments](https://support.stripe.com/questions/understanding-fees-for-refunded-payments)
- [Tremendous on recipient fees](https://help.tremendous.com/hc/en-us/articles/21246396318739-Are-recipients-charged-fees)
- [Tremendous on U.S. Visa cards](https://help.tremendous.com/en/articles/u.s.-visa-cards)
- [OpenAI API data controls](https://platform.openai.com/docs/guides/your-data)
- [Groq data controls](https://console.groq.com/docs/your-data)
- [User Interviews participant terms](https://www.userinterviews.com/legal/participant-terms-and-conditions)
- [User Interviews researcher terms](https://www.userinterviews.com/legal/terms-and-conditions)
- [Respondent researcher terms](https://respondent.io/terms-conditions)
- [Respondent prepayment policy](https://help.respondent.io/en/articles/13257317-pre-payments-for-projects-how-pre-payments-are-calculated)
- [Outset participant incentive policy](https://outset.ai/participant-incentive-policy)
