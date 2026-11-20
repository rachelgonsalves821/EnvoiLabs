# Agent 2 brief. Respondent experience

You build everything a student or consumer touches, from the invite link to the gift card, and you own the design system package that both apps use. Your bar is a respondent getting from link to first paid interview in under 10 minutes, on a phone, without help.

## You own
- `apps/web/app/(respondent)/r/**` and `apps/web/app/api/respondent/**` (thin handlers)
- `apps/web/inngest/respondent/**` (push sending jobs)
- `packages/ui/**` (tokens, components, the Echo). Agent 3 may add researcher-only components under `packages/ui/src/researcher/` and must follow your conventions
- The web push sender in `packages/integrations/push`
- Respondent Playwright specs in `apps/web/e2e/respondent/`

## You depend on
| From | What | By |
| --- | --- | --- |
| Agent 1 | Contracts v1, auth helpers, fakes, seed | Gate 0 |
| Agent 1 | Session services `startSession`, `recordAnswer`, `submitSession`, `resumeSession` | Week 2 |
| Agent 1 | Points, payout and quality hold services | Week 4 |
| Agent 3 | `ProbeDecision` events on answer upload (`probe.ready`) | Week 5 |

Until a dependency lands, build against the fakes in `packages/testing` and log each in `docs/DEBT.md`.

## Design system rules
Source of truth is the [Envoi Labs design system](https://claude.ai/artifact/JfVmxVS4SJQXzqePCWf2n2). Copy its `tokens.json` into `packages/ui/tokens/tokens.json` and generate CSS variables with a script (`pnpm --filter ui gen:tokens`). CI fails if the generated CSS is stale.
- One typeface, Manrope (Google Fonts, `next/font`, weights 400 to 800).
- Colors `fog` page, `paper` surfaces, `ink` text, `pulse` one loud moment per view, `zest` money only, `tide` researcher data.
- Light and dark themes via `data-theme`. Every text pair at least 4.5:1.
- Motion. Enter and exit `cubic-bezier(0.23, 1, 0.32, 1)`, sheets `cubic-bezier(0.32, 0.72, 0, 1)`, presses `scale(0.97)` over 140ms, nothing interactive over 400ms, `prefers-reduced-motion` respected.
- Copy in `copy.ts` per route, sentence case, no em dashes, concrete numbers.

## Gate 0 tasks (week 1)
1. `packages/ui` with token generation, `Button` (primary, pulse, secondary, ghost, small), `Chip` (tones from the design system), `EarningsChip`, `ProgressTrack`, `Card`, `Sheet` (Radix Dialog based), `Field`.
2. `Echo` component API final from day one so others can use it.
   ```ts
   type EchoState = 'idle' | 'listen' | 'think' | 'sent' | 'payout';
   interface EchoProps { state: EchoState; size: number; level?: () => number; 'aria-hidden'?: boolean }
   ```
   Week 1 renders the static fallback disc. The WebGL version lands in week 6 behind the same API.
3. Respondent shell. Layout with safe areas, `100dvh`, top bar slot, mobile-first breakpoints (360, 390, 430). PWA manifest, icons placeholder, service worker registered (no caching of authenticated API responses).
4. Phone signup screens wired to Agent 1's auth helper with `FakeTwilio` in CI.

## Gate 1 tasks (weeks 2 to 3) → R-RESP-01, 02, 03, 04, 06, 07
1. **Profile** (R-RESP-02). 6 to 8 questions from a config file in `packages/contracts/profile-questions.ts` (owned by Agent 1, you propose content via `[CONTRACT]` PR). Tap answers, optional voice. Saves through services.
2. **Consent** (R-RESP-03). One screen, four toggles with plain language, links to full text. Enforce consent for recording and transcription before accepting voice. Keep researcher access and voice sharing separate. Preserve typed answers and confirm study eligibility rules with Platform. Store `text_version`.
3. **Home and invite card** (R-RESP-04). Invite list sorted by expiry. Card content and order exactly as the design system InviteCard. "Not for me" with optional reason chips.
4. **Interview screen** (R-RESP-06).
   - One question per screen. Top bar has `ProgressTrack` and `EarningsChip`. Topic line, question in display style, hint line.
   - Record button is the Echo inside a `<button aria-pressed>` with labels "Start recording" and "Stop recording". Tap to start and tap to stop. No hold-to-talk.
   - "Type instead" opens a textarea sheet.
   - Recording status region with `role="status"` showing "Recording" and a timer.
   - Max answer length 3 minutes with a warning at 2:30.
5. **Voice capture and upload** (R-RESP-07).
   - `MediaRecorder`. Prefer `audio/webm;codecs=opus`, fall back to `audio/mp4` on Safari. Record mono.
   - Expose a mic level function from an `AnalyserNode` for the Echo.
   - On stop, request scoped authorization through `StartAudioUpload`, upload to the signed storage URL, then confirm against the same server-issued answer and upload IDs. Retry 3 times with backoff. Keep the blob in IndexedDB until the server confirms, so a crash never loses an answer.
   - Show "Got it" and move to the next question within 320ms of confirm.
   - Resume link (`/r/s/[token]`) lands on the next unanswered question.
6. **Liveness phrase screen** before question 1 (stub in Gate 1, real check in Gate 3). Shows a 4-word phrase and records it like an answer.
7. Respondent half of `IT-1.1` and all of `IT-1.3`.

## Gate 2 tasks (weeks 4 to 5) → R-RESP-05, 09, 10, 11
1. **Confirming screener** (R-RESP-05). Up to 3 questions in a sheet before the invite turns into an interview.
2. **Push** (R-RESP-09). VAPID keys from env. Subscription stored via services. Jobs in `inngest/respondent` send the invite push, the halfway nudge (when half the questions are answered and no activity for 2 hours) and the 2-hours-left nudge. Each nudge deep-links to the resume token. Snooze for 3 hours and decline actions.
3. **iPhone install guide** after the first payout. A 3-step sheet with screenshots placeholder, shown once, dismissible, re-openable from profile. Detect iOS Safari and standalone mode.
4. **Receipt and payout** (R-RESP-10). Instant receipt screen with the Echo in `payout` state and the amount counting up once over 700ms. "Pending quality check" with expected date. Gift card picker from Agent 1's catalog after the first approved complete. Payout history.
5. **Points and levels** (R-RESP-11). Earnings screen with total, points with cash value, streak, next milestone. Never show money at risk.
6. `IT-2.6` with Agent 1, plus respondent steps of `IT-2.1`.
7. Before the first real study, add the baseline probe display and timeout with Agent 3, and run the mobile and privacy checks in BUILD_PLAN section 6.

## Gate 3 tasks (weeks 6 to 7) → R-RESP-08, 12, 13, 14
1. **Full Echo.** WebGL fragment shader or three.js, matching the design system preview (glossy pulse body, peach highlight, lilac rim). States idle, listen (driven by mic level), think, sent, payout. Pause the render loop when off-screen or hidden. One still frame under reduced motion. Flat disc when WebGL is missing. Lazy-load the Echo chunk so it never blocks first paint.
2. **Probe display hardening** (R-RESP-08). After upload, Echo goes to `think`. Subscribe to `probe.ready` for the answer (Supabase Realtime or polling at 1 s). Show the probe within the same screen as a follow-up, then continue. If no probe arrives in 8 seconds, move on without it and log `probe.timeout`.
3. **Privacy controls** (R-RESP-12). Delete account, export, stop invites, withdraw from a study, voice sharing per study. Each is a single clear screen with a confirmation for destructive actions.
4. **WhatsApp waitlist** (R-RESP-13). Optional checkbox on signup, "Prefer to answer on WhatsApp? Join the waitlist."
5. **Referrals** (R-RESP-14). Share link with native share sheet, referral status list.
6. Accessibility. axe on every respondent screen with zero serious issues, keyboard and VoiceOver walkthrough of the interview screen.

## Gate 4 tasks (week 8)
Performance budget on the interview screen (LCP under 2.5 s on a mid-range phone profile, JS under 200 KB gzipped excluding the lazy Echo chunk). Copy review against the design system voice. Empty, error and offline states on every screen.

## Quality bar
- Every screen works at 360px wide and with the keyboard open.
- Every async action has loading, success and error states with the design system copy ("We couldn't hear that one. Tap to try again, or type instead.").
- Never block the interview on a non-essential call (analytics, push subscription, points).
