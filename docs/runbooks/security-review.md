# Gate 4 security review, first pass

Reviewed 2026-11-23 on `codex/gate-4-parallel` against the [OWASP Top 10:2025](https://top10.owasp.org/2025/0x00_2025-Introduction/). This is a source and synthetic-CI review, not a penetration test or a release decision. Recheck every row on the integrated launch revision.

| Risk | Evidence inspected | Open check or finding |
| --- | --- | --- |
| A01 Broken Access Control | `packages/db/tests/workspace_access.sql` declares an all-table RLS matrix and fails if an application table is missing. PR #113 database checks passed. The Gate 1 answer worker validates scoped claims and leases. | Re-run the matrix after Gates 2 and 3 migrations, then test researcher exports, private media links, and cross-tenant access on the integrated app. |
| A02 Security Misconfiguration | `gate1InngestConfig` requires explicit enable flags, a trusted database URL, and a signing key in preview/production. | Review deployed configuration, storage bucket privacy, headers, and allowed origins. Do not infer hosted settings from source. |
| A03 Software Supply Chain Failures | `pnpm audit --json` on the pinned lockfile: 325 production dependencies, 2 moderate advisories, 0 high or critical on 2026-11-23. The affected path is `inngest` → OpenTelemetry auto instrumentation → GCP metadata → gaxios → rimraf → `glob@10.5.0` → `minimatch@9.0.9`. | [glob GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) need an owner to resolve or document bounded exposure before launch. Root dependency/lockfile edits require coordinator assignment. Re-run audit on final lockfile. |
| A04 Cryptographic Failures | `private-audio.ts` checks byte length, container, and SHA-256 before answer confirmation; `respondent.ts` binds age proof to the email with HMAC. | Verify TLS, encryption at rest, secret rotation, signed URL expiry, and private key handling in the hosted environment. |
| A05 Injection | API `input` requires JSON and exact origin; service calls pass fixed RPC names and structured arguments. | Review all Gate 2/3 dynamic queries, report rendering, and model output sinks after integration. |
| A06 Insecure Design | Publication requires qualified redaction policy; failed redaction remains private. Consent and lease checks occur before processing. | Gate 1 independent redaction qualification is open; rehearse withdrawal and delayed-job behavior, then review payment and payout invariants. |
| A07 Authentication Failures | Respondent/researcher start routes use Supabase OTP; researcher access requires MFA. Provider 429 is relayed. | Enforce application-level limits before OTP dispatch and signed-upload reservation, including distributed concurrency and privacy-preserving keys; test 429 and recovery. See [rate-limit inventory](rate-limit-inventory.md). |
| A08 Software or Data Integrity Failures | The answer path checks recording digest and uses durable leases and idempotent completion. | Test Stripe and Tremendous signature, event order, duplicate delivery, and uncertain outcomes once Gate 2 services integrate. |
| A09 Security Logging and Alerting Failures | Current workers mask private database/provider errors from scheduler logs. | R-PLAT-12 observability is not complete. Verify structured safe logs, alerting, incident routing, and access to job dashboards. |
| A10 Mishandling of Exceptional Conditions | Answer processing retries provider failure and keeps redaction failures private. | Complete IT-4.2 on integrated LLM, transcription, and payout paths; rehearse runbooks and confirm no raw response leaks in failure logs. |

## Rate-limit path inventory and acceptance cases

The route file is a thin handler; the service path named here is where a limit must run before the expensive or externally visible action. No application limiter was found in these paths on this revision. Supabase returning 429 is a secondary provider guard, not proof that the application controls request volume.

| Surface | Route → current service/action | Required local acceptance cases after Gate 1 handoff |
| --- | --- | --- |
| Respondent email link | `POST /api/respondent/auth/start` → `server/auth/respondent.ts:respondentStart` → `signInWithOtp` | Same normalized email and source exceed policy: 429 before OTP call. Separate emails from one source and one email across sources are bounded. Concurrent requests cannot all pass. Valid traffic recovers when the window ends. Generic responses do not reveal account existence. |
| Researcher email link | `POST /api/researcher/auth/start` → `server/auth/researcher.ts:researcherStart` → `signInWithOtp` | Same cases; preserve `shouldCreateUser:false`, generic response, and pending PKCE verifier. |
| Signed audio upload reservation | `POST /api/respondent/answers/upload` → `server/respondent/private-audio.ts:startAudioUpload` → `reserve_gate1_audio` and `createSignedUploadUrl` | Authenticated respondent is bounded before reservation and signing. 429 creates no reservation or URL. Concurrent requests converge under one quota. Another respondent cannot consume the same per-account quota. Invalid or unauthenticated calls do not reveal quota state. |
| Direct object transfer | Browser uploads to a Supabase signed URL after reservation. | Verify storage-side size, MIME, object path, URL expiry, and service or edge limits; API request limits alone do not bound transfer bandwidth. |

Also inspect `POST /api/respondent/answers/record` for typed-answer abuse and confirmation costs. It is not a substitute for the required sign-in and upload controls. The acceptance test implementation belongs with the eventual limiter after Gate 1 releases these paths.
