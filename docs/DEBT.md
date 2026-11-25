# Technical debt register

Every shortcut, stub, fake or TODO gets a row. Debt without a must-fix gate is not allowed. Each gate review closes or re-dates rows.

| ID | Description | Owner | Created | Must fix by | Status |
| --- | --- | --- | --- | --- | --- |
| D-001 | Respondent incentive per question is a placeholder (40 cents) pending PRD Q-01 | Agent 1 | 2026-11-19 | Gate 2 | Open |
| D-002 | Commit the CI-generated pnpm lockfile and require frozen installs | Agent 1 | 2026-11-19 | Gate 0 | Closed |
| D-003 | Complete the draft contracts with Gate 1 APIs, public entity schemas and typed events | Agent 1 | 2026-11-19 | Gate 0 | Closed |
| D-004 | Add database integration, Playwright and generated-file drift checks to the initial PR workflow | Agent 1 | 2026-11-19 | Gate 0 | Closed |
| D-005 | Verify live transcription on approved synthetic audio. Keep the deterministic transcription fake for CI | Agent 3 | 2026-11-22 | Gate 1 | Closed. [Live provider smoke](https://github.com/rachelgonsalves821/EnvoiLabs/actions/runs/45280585136) and [hosted worker evidence](STATUS.md#2026-11-23--gate-1-hosted-scheduler-and-speech-verification) |
| D-006 | The disposable browser study uses fixed redaction output and synthetic approval digests to verify the researcher panel. Qualify private redaction on independent recognized speech and verify the signed-in hosted researcher view before allowing real publication. Keep the fixed output in disposable tests. | Agent 3 | 2026-11-22 | Gate 1 | Open |
| D-007 | The seeded Gate 1 launch uses the preview-only `skip_payment` path. Gate 2 marketplace studies must go through the test-mode Stripe checkout and payment confirmation flow. Keep the bypass confined to the seeded non-production study. | Agent 1 | 2026-11-25 | Gate 2 | Open |
