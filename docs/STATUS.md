# Status and handoffs

Append-only. Newest entries at the bottom. Use the template in `docs/BUILD_PLAN.md` section 9.

## Gate checklist tracker

| Gate | Target | State | Evidence |
| --- | --- | --- | --- |
| Gate 0 Foundations | End of week 1 | In progress | |
| Gate 1 Vertical slice | End of week 3 | Not started | |
| Gate 2 Money loop and scoping | End of week 5 | Not started | |
| Gate 3 Probing, reports, pilot | End of week 7 | Not started | |
| Gate 4 Launch hardening | End of week 8 | Not started | |

## Entries

## 2026-11-19, Rachel (via Claude)
Done: PRD, build plan and agent briefs written
Next: Agent 1 starts Gate 0. Agents 2 and 3 start their week 1 items against fakes
Needs from others: none
Contract or schema changes: none yet
Risks: pricing (PRD Q-01) and counsel checks (Q-04 to Q-06) are open

## 2026-11-19 19:03, Agent 1 (Platform)
Done: Kickoff scaffold with pnpm, Turborepo, Next.js, PR CI and draft shared contracts for R-RSCH-02, R-RSCH-03, R-RSCH-08, R-RESP-04, R-RESP-06 and R-RESP-08. The contract build, typecheck and 17 contract tests passed locally.
Next: Verify all scaffold checks in GitHub CI, commit the generated lockfile, then finish Gate 0 schema, auth, contracts and fakes.
Needs from others: Respondent and Researcher can use the draft contracts after the scaffold merges.
Contract or schema changes: Draft Brief, BriefPatch, GuideDraft, ScopingTurn, ProbeDecision, QualitySignals, ThemeSet, InvitePreview and InterviewProgress with parsing tests. The full v1 contracts are still in progress.
Risks: The local environment could not reach the package registry to complete the monorepo install. The first GitHub CI run can generate the lockfile.

## 2026-11-19 21:16, Agent 1 (Platform)
Done: R-RESP-01 and R-RSCH-01 identity migration with tenant, self-only and MFA access boundaries. Added the first IT-0.2 pgTAP checks and a fresh-migration CI job.
Next: Wire server-side signup and enrollment, expand the schema and access matrix, and add the Gate 0 seed.
Needs from others: Rachel’s privacy review before merge.
Contract or schema changes: Added organizations, researcher membership, respondent identity and a server-only private phone table.
Risks: The local Docker daemon was unavailable. The migration and pgTAP tests need their first GitHub CI run before this slice can merge.
