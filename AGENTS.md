# Rules for every coding agent on Envoi Labs

You are one of three coding agents building Envoi Labs, a voice-first AI market research product. Read this file first in every session.

## Start of every session
1. Read `docs/PRD.md` (what and why).
2. Read `docs/BUILD_PLAN.md` (ownership, current acceptance criteria, pre-study checks and cross-agent implementation rules).
3. Read your brief in `docs/agents/` (Agent 1 Platform, Agent 2 Respondent, Agent 3 Researcher and AI).
4. Read the last 10 entries of `docs/STATUS.md` and any open `[NEEDS <your agent>]` issues.
5. Check which gate we are in. If the gate's integration suite is red, fixing it comes before any new feature.

## While working
- Only change files you own (BUILD_PLAN section 3). Shared files follow BUILD_PLAN section 4.
- Tie every branch, PR and commit to a requirement ID from the PRD.
- Write tests with the code. Pure logic gets unit tests. Flows get integration tests.
- Keep PRs small, under about 400 changed lines excluding generated files.
- Never put business logic in route handlers. Never compute prices or payouts in an LLM.
- Never let researcher-facing code touch PII.
- Money is integer cents. Time is UTC.
- Use fakes from `packages/testing/fakes` for anything not built yet, and log each one in `docs/DEBT.md`.
- Tag PR titles `[MONEY]` for pricing, payouts or Stripe, `[PRIVACY]` for redaction, consent, PII or RLS, and `[COPY]` for user-facing claims. Codex may review and merge under Rachel’s standing delegation once the relevant checks pass. Record consequential decisions as delegated.
- Price is $1 per core question per respondent (PRD section 10). Never hard-code it. Read it from `pricing_configs`.
- For every UI task, follow the design system and the workflow in [UI resource registry](docs/UI_RESOURCES.md). List the references used and the resulting design decisions in the PR.

## Keep the PRD alive
- Set a requirement to `In progress` with your agent name when you start it.
- Set it to `Done` with the test file path as evidence when it merges green.
- If you change behavior the PRD describes, update the PRD in the same PR and add a changelog line.
- If a requirement looks wrong, add an Open question (PRD section 14) and mark it `Needs decision`. Do not quietly change scope.

## End of every session
Append to `docs/STATUS.md` using the template in BUILD_PLAN section 9.

## Never
- Change decisions in PRD section 5 without Rachel.
- Commit secrets.
- Merge with failing tests, or skip a test to get green.
- Delete a PRD requirement (mark it `Cut` with a reason).
- Use em dashes, title case or all-caps labels in user-facing copy.
