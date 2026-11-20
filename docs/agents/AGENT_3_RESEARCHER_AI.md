# Agent 3 brief. Researcher app and AI

You build what founders touch, from the first scoping message to the report, and every AI behavior in the product. Your bar is a founder getting from a vague goal to a paid study in under 15 minutes, and trusting the report enough to repeat its findings in a meeting.

## You own
- `apps/web/app/(researcher)/app/**` and `apps/web/app/api/researcher/**` (thin handlers)
- `apps/web/inngest/ai/**` (transcription, probe, redaction, analysis jobs)
- `packages/ai/**` (providers, prompts, agents, redaction, evals)
- `packages/services/src/ai/**` (persistence for AI outputs, using Agent 1's typed db queries)
- `packages/ui/src/researcher/**` (researcher-only components, following Agent 2's conventions)
- Researcher Playwright specs in `apps/web/e2e/researcher/`

## You depend on
| From | What | By |
| --- | --- | --- |
| Agent 1 | Contracts v1 (`Brief`, `BriefPatch`, `GuideDraft`, `ProbeDecision`, `ThemeSet`, `QualitySignals`), auth, fakes | Gate 0 |
| Agent 1 | Study lifecycle services and `study.*` events | Weeks 2 and 4 |
| Agent 1 | Pricing and feasibility services | Week 4 |
| Agent 2 | `packages/ui` base components and the Echo API | Gate 0 |

## AI engineering rules
1. Every LLM call goes through `packages/ai/llm.ts`, which logs to `llm_calls` (purpose, model, tokens, latency, cost, ok).
2. Prompts are files in `packages/ai/prompts/<agent>/<version>.md`. Changing a prompt means a new version file, and the eval must pass before the version is promoted in `prompts/active.json`.
3. Structured output only. Every agent returns data validated by a contract schema. On validation failure retry once with the error, then fail safe.
4. No LLM ever outputs a price, a payout amount or a quality decision. It may output signals that `packages/core` turns into decisions.
5. Researcher-facing AI only reads `redacted_text`. Raw transcripts are read only by the redaction job and the interviewer (respondent side).
6. Fixture-replay mode for tests. Record responses from synthetic or expressly approved test inputs and replay them in CI by request hash. Keep participant data out of the repo and CI logs.
7. Fail-safe defaults. If the interviewer fails or times out, the interview continues without a probe. If analysis fails, the study shows "Report in progress" and retries.

## Gate 0 tasks (week 1)
1. `packages/ai` skeleton with `LLMProvider` (Anthropic implementation plus fake) and `Transcriber` (OpenAI `gpt-4o-mini-transcribe` implementation, Groq Whisper fallback, fake).
2. Eval harness `pnpm --filter ai eval <name>` that runs a fixture set, scores with rubric functions and an LLM judge, and writes a JSON report. CI job that fails below threshold.
3. Researcher shell. Left rail (studies list, new study, billing), main column, right panel slot. Desktop first at 1280px, works at 1024px, brief becomes a sheet under 900px.
4. Researcher auth screens (magic link, TOTP setup) using Agent 1's helpers.

## Gate 1 tasks (weeks 2 to 3) → R-RSCH-07 partial, R-RSCH-10 partial, R-PLAT-07
1. **Minimal study form** (temporary, replaced by scoping in Gate 2). Title, target completes, 2 criteria, 4 core guide questions, launch with `skip_payment` flag in non-prod.
2. **Transcription job** on `answer.uploaded`. Fetch audio from storage, transcribe with timeout 20 s, fallback provider on error, store transcript with metadata, emit `transcript.ready`.
3. **Redaction v1** (R-PLAT-07). Follow BUILD_PLAN sections 11 and 12. Evaluate Presidio with Platform, run the approved contextual pass, and publish `redacted_text` only after both checks pass. Raw text stays in the PII schema.
4. **Tracking page v1** (R-RSCH-07). Counts from services, live updates via Supabase Realtime, sample composition table, removals list.
5. **Transcript viewer** (R-RSCH-10 partial). Redacted transcripts per respondent with profile descriptor (never name).
6. Researcher half of `IT-1.1`, plus `IT-1.2` jointly with Agent 1.

## Gate 2 tasks (weeks 4 to 5) → R-RSCH-01 to 06, R-PLAT-04 signals
1. **Scoping agent** (R-RSCH-02, 03, 04).
   - System prompt implements PRD 7.1 exactly. Question order is decision, hypotheses, must-have and nice-to-have criteria, exclusions, number of completes, stimulus, deadline.
   - Each turn returns `{ message, quickReplies[], briefPatch }`. Apply the patch through `packages/services` `updateBrief`, which validates and versions.
   - Criteria must be written as behavior in a time window ("ordered food after 10pm in the last 30 days"). If the researcher gives an identity label, the agent proposes a behavioral version.
   - Sizing detection. If the goal asks "how many", "what percent" or "market size", the agent explains in one or two sentences that interviews cannot size, and offers what they can answer.
   - Researchers can paste a block of questions. The agent turns them into guide questions, flags leading ones and suggests rewrites.
   - When the brief is complete, the agent drafts the guide (6 to 8 core questions, open, non-leading, past behavior) as a `GuideDraft`.
2. **Live brief panel** (R-RSCH-03). Every section visible from the start as a placeholder saying what comes next. Inline editing. Every agent change is announced in chat with a caption line.
3. **Quote and feasibility UI** (R-RSCH-05). Calls Agent 1's `quoteStudy`. Shows total in the stat style, line items, feasibility sentence with a status chip. "Approve and pay $140" button repeats the amount (7 questions × 20 respondents × $1).
4. **Checkout UI** (R-RSCH-06). Redirect to Stripe Checkout, success page that waits for the webhook state change, cancel page.
5. **Quality signals.** An LLM judge in `packages/ai/quality` scores each transcript for specificity and relevance (0 to 100 each) against the guide question, plus the consistency check result for the re-asked profile fact. Emit `QualitySignals`. Agent 1's quality hold turns these into a decision.
6. **Interviewer agent v1** (PRD 7.2) for the first real study. Record the OpenInterviewer review before implementation and verify the complete probe path with Agent 2.
   - Triggered on `transcript.ready` for core-question answers.
   - Input is the guide question, the transcript, prior answers in this session and the study goal.
   - Output `ProbeDecision { action: 'probe' | 'next', text? }`. Max 2 probes per core question. Never leading. Never reveals the client.
   - Latency budget p95 under 6 s from upload to probe, so use a fast model and a short prompt. Measure and log.
   - Emit `probe.ready` for Agent 2.
7. Researcher steps of `IT-2.1`.

## Gate 3 tasks (weeks 6 to 7) → R-RSCH-08, 09, 11, R-RESP-08 backend
1. **Analyst agent** (PRD 7.3). Map step codes each redacted transcript against hypotheses and guide questions. Reduce step builds a `ThemeSet`. Confidence rules exactly as the PRD. Hypothesis scores supported, weakened or untested.
2. **Evidence verification.** Review OpenVerbatim's evidence-location pattern. Every quote must match an exact span in the redacted source version for that study (`start_char`, `end_char`). Drop invalid evidence and invalidate published references when the source changes or is withdrawn. `IT-3.2`.
3. **Report UI** (R-RSCH-08). Executive answer first, then FindingCards (claim, dot strip, "11 of 20 said this", confidence chip, one lead quote with clip if consented), segment cuts, contradictions, methods appendix (sample against spec, removals, guide). Counts only below 30 completes.
4. **Next-study proposal** (R-RSCH-09). A `Brief` draft from the analyst, opened in the scoping screen pre-filled, launchable in two clicks after quote.
5. **Honest labels** (R-RSCH-11). "Directional qualitative" on every study and report. "Student convenience sample" when over 50% of completes are students.
6. **Evals to threshold.** All rows in BUILD_PLAN section 7 green in replay mode, and nightly live runs recorded.

## Gate 4 tasks (week 8)
CSV and PDF export (R-RSCH-10). Copy review of every agent prompt and UI string against the design system voice. LLM outage fallback (interviews continue with the static guide, scoping shows a form fallback). Cost report per study from `llm_calls`.

## Quality bar
- The scoping chat never shows a wall of text. One question, under 80 words, with quick replies.
- Nothing the researcher sees can contain respondent PII. `IT-3.3` scans for it.
- Every finding has a count and at least one verified quote.
