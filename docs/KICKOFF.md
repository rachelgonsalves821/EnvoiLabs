# How to run the three coding agents

This is for Rachel. It explains how to set up, start and supervise the three agents so they work in parallel without colliding.

## 1. Setup (once)

1. Create one GitHub repo. Unzip the build kit at the root so `AGENTS.md` and `docs/` are committed on `main`.
2. Give each agent its own working copy so they never edit the same files on disk.
   ```
   git worktree add ../envoi-platform   -b agent1/setup
   git worktree add ../envoi-respondent -b agent2/setup
   git worktree add ../envoi-researcher -b agent3/setup
   ```
   Run one coding agent session in each folder.
3. Protect `main`. Every change lands by PR with CI green. Turn on "require branches to be up to date".
4. Create accounts and put test keys in each worktree's `.env.local` (Agent 1 writes `.env.example` listing them). Supabase (one dev project for previews, local Supabase for each agent), Stripe test mode, Tremendous sandbox, Twilio test credentials, OpenAI, Anthropic, Groq, Sentry, Inngest, Vercel.

## 2. Start order

| When | Who runs | Why |
| --- | --- | --- |
| Day 1, first half | **Agent 1 only** | Scaffolds the monorepo, CI, the empty packages and a first draft of `packages/contracts`. If all three start on an empty repo they will create conflicting scaffolds |
| Day 1, once Agent 1's scaffold PR merges | **Agents 2 and 3 join** | They start on work inside their own packages (`packages/ui`, `packages/ai`) and their app route folders, using fakes |
| Weeks 1 to 8 | All three in parallel | Follow the week table in BUILD_PLAN section 10 |
| Each gate week | Agent 1 leads, others fix | Feature work pauses until the gate's tests are green |

## 3. Kickoff prompts (paste one into each agent)

**Agent 1, Platform**
```
You are Agent 1 (Platform) on Envoi Labs. Read AGENTS.md, docs/PRD.md, docs/BUILD_PLAN.md and docs/agents/AGENT_1_PLATFORM.md in that order.
Your first job is the repo scaffold from BUILD_PLAN section 3 (pnpm, Turborepo, empty packages with READMEs, CI running typecheck, lint and an empty test), then a first draft of packages/contracts. Open one PR for the scaffold and merge it as soon as CI is green, because Agents 2 and 3 are waiting on it.
Then work through your Gate 0 task list. Keep the PRD statuses current and append to docs/STATUS.md at the end of the session.
```

**Agent 2, Respondent**
```
You are Agent 2 (Respondent) on Envoi Labs. Read AGENTS.md, docs/PRD.md, docs/BUILD_PLAN.md and docs/agents/AGENT_2_RESPONDENT.md in that order. Read the last entries in docs/STATUS.md.
Start with your Gate 0 tasks in packages/ui (token generation from the design system tokens.json, base components, the Echo component API with the static fallback) and the respondent shell. Use fakes from packages/testing for anything Agent 1 has not shipped yet and log each in docs/DEBT.md.
Only edit files you own. Keep the PRD statuses current and append to docs/STATUS.md at the end of the session.
```

**Agent 3, Researcher and AI**
```
You are Agent 3 (Researcher and AI) on Envoi Labs. Read AGENTS.md, docs/PRD.md, docs/BUILD_PLAN.md and docs/agents/AGENT_3_RESEARCHER_AI.md in that order. Read the last entries in docs/STATUS.md.
Start with your Gate 0 tasks in packages/ai (provider interfaces with fakes, prompt file structure, the eval harness) and the researcher shell. Use fakes for anything Agent 1 has not shipped yet and log each in docs/DEBT.md.
Only edit files you own. Keep the PRD statuses current and append to docs/STATUS.md at the end of the session.
```

**Every later session (any agent)**
```
Continue as Agent N. Read AGENTS.md, then the last 10 entries of docs/STATUS.md and any open issues tagged [NEEDS AGENT N]. Check the current gate in docs/STATUS.md. If its tests are red, fix those first. Otherwise take the next task in your brief.
```

## 4. Daily rhythm

1. **Morning.** Agent 1 merges any contract or migration PRs first. Agents 2 and 3 rebase on `main` before starting.
2. **During the day.** Each agent opens small PRs tied to a requirement ID. CI must be green to merge.
3. **End of session.** Each agent appends to `docs/STATUS.md`. Read the three entries (10 minutes) and answer anything marked `Needs decision` or `[NEEDS RACHEL]`.

## 5. What only you do

- Answer open questions in PRD section 14 (pricing incentive Q-01, minimum study size Q-01b, iPhone nudge Q-02, counsel checks Q-04 to Q-06).
- Review every PR that touches money (`packages/core/pricing`, payouts, Stripe), privacy (redaction, consent, RLS) or user-facing claims. The agents flag these in the PR title with `[MONEY]`, `[PRIVACY]` or `[COPY]`.
- Run the gate review. When Agent 1 posts the gate checklist in `STATUS.md`, check the evidence links, then reply "Gate N passed" in STATUS.md. Agents do not start the next gate's features without it.
- Recruit the hand-picked respondents and be the researcher for the first real study at Gate 2.

## 6. If you can only run one or two agents at a time

| Agents available | How to split |
| --- | --- |
| 1 | Run the briefs in order Agent 1 → Agent 3 → Agent 2 within each gate. Gates stay the same, the timeline roughly doubles |
| 2 | Agent A takes the Agent 1 brief. Agent B alternates between the Agent 2 and Agent 3 briefs by week (respondent work in weeks 1, 2, 5, 6 and researcher and AI work in weeks 3, 4, 7, 8) |
| 3 | As written |
