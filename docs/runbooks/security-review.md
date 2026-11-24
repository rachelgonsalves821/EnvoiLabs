# Gate 4 security review, first pass

Reviewed 2026-11-23 on `codex/gate-4-parallel` against the [OWASP Top 10:2025](https://top10.owasp.org/2025/0x00_2025-Introduction/). This is a source and synthetic-CI review, not a penetration test or a release decision. Recheck every row on the integrated launch revision.

| Risk | Evidence inspected | Open check or finding |
| --- | --- | --- |
| A01 Broken Access Control | `packages/db/tests/workspace_access.sql` declares an all-table RLS matrix and fails if an application table is missing. PR #113 database checks passed. The Gate 1 answer worker validates scoped claims and leases. | Re-run the matrix after Gates 2 and 3 migrations, then test researcher exports, private media links, and cross-tenant access on the integrated app. |
| A02 Security Misconfiguration | `gate1InngestConfig` requires explicit enable flags, a trusted database URL, and a signing key in preview/production. | Review deployed configuration, storage bucket privacy, headers, and allowed origins. Do not infer hosted settings from source. |
| A03 Software Supply Chain Failures | `pnpm audit --json` on the pinned lockfile: 325 production dependencies, 2 moderate advisories, 0 high or critical on 2026-11-23. The affected path is `inngest` → OpenTelemetry auto instrumentation → GCP metadata → gaxios → rimraf → `glob@10.5.0` → `minimatch@9.0.9`. | [glob GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) and [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) need resolution or a documented bounded-exposure decision before launch. Gate 4 now owns the root dependency review, after Gate 2/3 dependency changes settle. Re-run audit on the final lockfile. |
| A04 Cryptographic Failures | `private-audio.ts` checks byte length, container, and SHA-256 before answer confirmation; `respondent.ts` binds age proof to the email with HMAC. | Verify TLS, encryption at rest, secret rotation, signed URL expiry, and private key handling in the hosted environment. |
| A05 Injection | API `input` requires JSON and exact origin; service calls pass fixed RPC names and structured arguments. | Review all Gate 2/3 dynamic queries, report rendering, and model output sinks after integration. |
| A06 Insecure Design | Publication requires qualified redaction policy; failed redaction remains private. Consent and lease checks occur before processing. | Gate 1 independent redaction qualification is open; rehearse withdrawal and delayed-job behavior, then review payment and payout invariants. |
| A07 Authentication Failures | Respondent/researcher start routes use Supabase OTP; researcher access requires MFA. Provider 429 is relayed. | Enforce application-level limits before OTP dispatch and signed-upload reservation, including distributed concurrency and privacy-preserving keys; test 429 and recovery. See the [rate-limit inventory](#rate-limit-path-inventory-and-acceptance-cases) below. |
| A08 Software or Data Integrity Failures | The answer path checks recording digest and uses durable leases and idempotent completion. | Test Stripe and Tremendous signature, event order, duplicate delivery, and uncertain outcomes once Gate 2 services integrate. |
| A09 Security Logging and Alerting Failures | Current workers mask private database/provider errors from scheduler logs. | R-PLAT-12 observability is not complete. Verify structured safe logs, alerting, incident routing, and access to job dashboards. |
| A10 Mishandling of Exceptional Conditions | Answer processing retries provider failure and keeps redaction failures private. | Complete IT-4.2 on integrated LLM, transcription, and payout paths; rehearse runbooks and confirm no raw response leaks in failure logs. |

The [Gate 2/3 draft-interface review and chaos fixture handoff](integration-chaos-fixtures.md) identifies synthetic provider, publication, and no-probe failures to run after their adapters land. It is a source review only; no integrated fault path passed here.

## Rate-limit path inventory and acceptance cases

The route file is a thin handler; the service path named here calls the Gate 4 decision before the expensive or externally visible action as of draft PR #113 head `7ac8cf5`. The opt-in is preview-only and no database store is connected, so no current deployment has proven application-level distributed protection. Supabase returning 429 is a secondary provider guard.

| Surface | Route → current service/action | Required local acceptance cases after Gate 1 handoff |
| --- | --- | --- |
| Respondent email link | `POST /api/respondent/auth/start` → `server/auth/respondent.ts:respondentStart` → `signInWithOtp` | Same normalized email and source exceed policy: 429 before OTP call. Separate emails from one source and one email across sources are bounded. Concurrent requests cannot all pass. Valid traffic recovers when the window ends. Generic responses do not reveal account existence. |
| Researcher email link | `POST /api/researcher/auth/start` → `server/auth/researcher.ts:researcherStart` → `signInWithOtp` | Same cases; preserve `shouldCreateUser:false`, generic response, and pending PKCE verifier. |
| Signed audio upload reservation | `POST /api/respondent/answers/upload` → `server/respondent/private-audio.ts:startAudioUpload` → `reserve_gate1_audio` and `createSignedUploadUrl` | Authenticated respondent is bounded before reservation and signing. 429 creates no reservation or URL. Concurrent requests converge under one quota. Another respondent cannot consume the same per-account quota. Invalid or unauthenticated calls do not reveal quota state. |
| Direct object transfer | Browser uploads to a Supabase signed URL after reservation. | Verify storage-side size, MIME, object path, URL expiry, and service or edge limits; API request limits alone do not bound transfer bandwidth. |

Also inspect `POST /api/respondent/answers/record` for typed-answer abuse and confirmation costs. It is not a substitute for the required sign-in and upload controls. The acceptance test implementation belongs with the eventual limiter after Gate 1 releases these paths.

### Distributed-limit test handoff

Gate 1 released the six named auth/upload files for this rate-limit insertion on November 24, recorded in the shared `gate-1.md` handoff. Gate 4 changed only those start/upload paths and adjacent tests. The limiter's shared atomic store remains Gate 2's migration responsibility; in-memory per-instance counts cannot establish a distributed limit.

Prepare a disposable integration fixture with two independent app processes pointing to one limiter store and one local Auth/storage stack. Freeze or advance the clock at the limiter boundary, and instrument OTP dispatch, `reserve_gate1_audio`, and signed URL creation. Assertions to add alongside the eventual implementation:

1. Send `N + 1` concurrent respondent OTP starts with the same normalized email and source across both processes, where `N` is the configured policy threshold. Exactly `N` may reach OTP dispatch; excess requests must return 429 and no dispatch. Repeat for researcher starts, preserving `shouldCreateUser:false` and a usable PKCE callback for accepted requests.
2. Vary email while holding source constant, then vary source while holding email constant. Both dimensions must be bounded under the approved policy. Compare unknown and known accounts for the same public response shape. Verify the same normalized email spelling shares a quota without storing plaintext email in the limiter key.
3. Advance beyond the window and confirm a valid request succeeds; confirm a malformed or cross-origin request is rejected before quota consumption and no account existence or quota balance leaks.
4. With a synthetic authenticated respondent and eligible answer, send `N + 1` parallel upload-reservation calls through both processes. At most `N` reach the reservation RPC and signed URL creation. Every 429 leaves no new reservation, object path, or signed URL. A second respondent retains a separate allowance; unauthenticated and invalid-answer requests reveal no quota state.
5. Exercise direct signed object transfer separately for size, MIME, path binding, expiry, and bandwidth policy. The application limit on URL creation does not enforce storage transfer volume.

Run these cases against the real distributed store in local integration and preview after Gate 1 handoff. The threshold symbol `N` avoids inventing a production policy in this preparatory review.

The coordinator approved the [Postgres atomic store and HMAC direction](rate-limit-proposal.md) for synthetic preparation. The exact migration and candidate thresholds have not been enabled.

### Isolated limiter security checkpoint

The Gate 4-owned decision module rejects missing or malformed policy, a short HMAC secret, absent/untrimmed source, invalid identity, and store failure before returning `allow`. The synthetic RPC adapter sends only hashed keys and maps null/error/malformed replies to an unavailable result. The standalone response helper uses the existing private, no-store and no-referrer headers with generic 400/429/503 bodies and a bounded `Retry-After`. Focused tests exercise these behaviors and two limiter instances sharing one atomic fixture. This is a code-path review, not proof that a real route is limited.

The [exact migration and route handoff](rate-limit-integration.md) remains a security dependency. Gate 2 must demonstrate all-or-none Postgres increments, disabled-by-default policy, service-only function execution, denied direct table access, cleanup, and generated types. Gate 4 owns the dedicated HMAC key interface and preview source parser; actual Vercel header ownership still needs a spoofed-client preview check. Synthetic handler tests now prove no OTP, reservation or signed URL on 429/503. Two-process tests against the real store, recovery, and direct signed-object transfer controls remain open. No production limiter is enabled by this checkpoint.

## November 24 dependency and RLS follow-up

On exact draft head `7ac8cf5`, a fresh `pnpm audit --prod --json` found the same 325 production dependencies and two moderate transitive advisories, with zero high or critical. Both are on the Inngest telemetry → GCP metadata → pinned gaxios → rimraf path above. The upstream advisories describe availability risks from aborted glob traversal and expensive minimatch patterns; this checkout has no evidence that user-provided interview data reaches that dependency path. This is a bounded source assessment, not a claim that the vulnerabilities are fixed. The narrow gaxios update remains pending Gate 2/3 dependency settlement, followed by a fresh audit, scheduler check, full build and CI.

The current all-table RLS matrix in `packages/db/tests/workspace_access.sql` enumerates `public` and `pii` base tables; it does not enumerate the proposed private `internal.gate4_rate_windows` table or function privileges. It also requires `service_role` SELECT on listed tables, whereas this limiter table must deny direct service-role reads. Gate 2's migration must add a separate explicit check for RLS and denied direct `anon`, `authenticated`, and `service_role` access on the internal table, plus service-only EXECUTE and fixed search path for the public RPC. The existing matrix should continue to cover all public/PII tables and be rerun on the integrated revision. A passing current matrix alone cannot certify the new limiter objects.

The draft PR's Vercel status is ready and its preview URL is present in the PR comment, but there is no safe request-header observer in the released paths and the limiter is disabled. Platform header documentation is not a substitute for testing whether client-supplied `x-vercel-forwarded-for` is overwritten at this actual ingress. Coordinate a temporary preview-only diagnostic or equivalent deployment log probe before enabling the feature; do not log or return raw client IPs.

## Narrow dependency proposal

The locked `gcp-metadata@8.1.4` requires exactly `gaxios@7.1.3`, which pulls `rimraf@5.0.10` and the two affected packages. The published `gaxios@7.1.4` has the same major API line and removes its `rimraf` dependency. A targeted pnpm override for `gcp-metadata@8.1.4>gaxios` to `7.1.4` is the narrowest candidate found; it changes the pinned parent's declared version, so it still requires integration tests and a runtime check of the GCP metadata path. The [upstream issue](https://github.com/googleapis/google-cloud-node-core/issues/925) also identifies the old pin. Wait for Gate 2/3 dependency changes, then apply the override and regenerated lockfile as one reviewed change, re-run `pnpm audit --prod --json`, build, CI and affected scheduler tests. Do not override `glob` directly to v14 across the incompatible `rimraf` major boundary.
