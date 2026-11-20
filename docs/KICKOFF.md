# How to run the three coding agents

This is for Rachel. It explains how to set up, start and supervise the three agents so they work in parallel without colliding.

## 1. Setup (once)

1. Start from the latest `main` in EnvoiLabs. Read the current gate evidence in [STATUS](STATUS.md) and the tasks still open on [goal #4](https://github.com/rachelgonsalves821/EnvoiLabs/issues/4).
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

The initial scaffold has merged. The Day 1 rows record the original setup sequence. Resume at the current gate in STATUS.

| When | Who runs | Why |
| --- | --- | --- |
| Day 1, first half | **Agent 1 only** | Scaffolds the monorepo, CI, the empty packages and a first draft of `packages/contracts`. If all three start on an empty repo they will create conflicting scaffolds |
| Day 1, once Agent 1's scaffold PR merges | **Agents 2 and 3 join** | They start on work inside their own packages (`packages/ui`, `packages/ai`) and their app route folders, using fakes |
| Weeks 1 to 8 | All three in parallel | Follow the week table in BUILD_PLAN section 10 |
| Each gate week | Agent 1 leads, others fix | Feature work pauses until the gate's tests are green |

## 3. Kickoff prompts (paste one into each agent)

For UI work in any lane, read [the UI resource registry](UI_RESOURCES.md) before design or implementation.

**Agent 1, Platform**
```
You are Agent 1 (Platform) on Envoi Labs. Read AGENTS.md, docs/PRD.md, docs/BUILD_PLAN.md and docs/agents/AGENT_1_PLATFORM.md in that order.
Resume from the merged foundations. Own hosted preview acceptance, reconcile the full Gate 0 checklist against evidence and line up the Gate 1 service and contract handoffs.
Then work through your Gate 0 task list. Keep the PRD statuses current and append to docs/STATUS.md at the end of the session.
```

**Agent 2, Respondent**
```
You are Agent 2 (Respondent) on Envoi Labs. Read AGENTS.md, docs/PRD.md, docs/BUILD_PLAN.md and docs/agents/AGENT_2_RESPONDENT.md in that order. Read the last entries in docs/STATUS.md.
Verify the merged respondent and UI foundations against Gate 0 evidence, then follow the respondent brief for the current gate. Use fakes from packages/testing for anything Agent 1 has not shipped yet and log each in docs/DEBT.md.
Only edit files you own. Keep the PRD statuses current and append to docs/STATUS.md at the end of the session.
```

**Agent 3, Researcher and AI**
```
You are Agent 3 (Researcher and AI) on Envoi Labs. Read AGENTS.md, docs/PRD.md, docs/BUILD_PLAN.md and docs/agents/AGENT_3_RESEARCHER_AI.md in that order. Read the last entries in docs/STATUS.md.
Verify the merged researcher and AI foundations against Gate 0 evidence, then follow the researcher brief for the current gate. Use fakes for anything Agent 1 has not shipped yet and log each in docs/DEBT.md.
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

## 5. Delegated reviews and founder responsibilities

- Answer open questions in PRD section 14 (pricing incentive Q-01, minimum study size Q-01b, iPhone nudge Q-02, counsel checks Q-04 to Q-06).
- Codex reviews PRs under Rachel’s standing delegation. Continue to tag money, privacy and user-facing claims with `[MONEY]`, `[PRIVACY]` and `[COPY]` and require passing checks.
- Agent 1 assembles the gate evidence in `STATUS.md`. Codex verifies it, records the delegated sign-off, and shares an update with Rachel before starting the next gate.
- Recruit the hand-picked respondents and be the researcher for the first real study at Gate 2.

## 6. If you can only run one or two agents at a time

| Agents available | How to split |
| --- | --- |
| 1 | Run the briefs in order Agent 1 → Agent 3 → Agent 2 within each gate. Gates stay the same, the timeline roughly doubles |
| 2 | Agent A takes the Agent 1 brief. Agent B alternates between the Agent 2 and Agent 3 briefs by week (respondent work in weeks 1, 2, 5, 6 and researcher and AI work in weeks 3, 4, 7, 8) |
| 3 | As written |
