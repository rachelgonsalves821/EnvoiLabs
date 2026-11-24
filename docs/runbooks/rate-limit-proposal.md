# Distributed sign-in and upload limit proposal

This is a Gate 4 proposal for coordinator and Gate 1 review, not an enabled control. The [exact route inventory and acceptance cases](security-review.md#rate-limit-path-inventory-and-acceptance-cases) identify the owned handler paths. Gate 4 will edit them only after Gate 1 releases those paths. The database migration and any shared environment configuration need a separate owner assignment.

## Store and atomic decision

Use the existing Postgres service database as one shared store for every app instance. A private `internal.request_rate_windows` table would hold only `(surface, key_kind, key_digest, window_start, hits, expires_at)` with a unique constraint on the first four fields. A `public.consume_gate4_rate_limit` RPC, callable only by the server's `service_role` client, would take the relevant HMAC digests and threshold/window policy, lock all matching keys in deterministic order inside one transaction, check both quotas, and increment both only when both can pass. A rejected call returns a generic `limited` result with `retry_after_seconds`, without incrementing one dimension or dispatching OTP/reserving audio. The RPC should use database time, never each app instance's clock. Deny direct table access to `anon` and `authenticated`, restrict the RPC's `EXECUTE` to `service_role`, pin its `search_path`, and purge expired rows after at most 24 hours. Include the function/table in the RLS and privilege review.

If the store is unavailable, return 503 with a short `Retry-After` before the OTP or signed-upload action; do not silently bypass the limit. Surface only aggregate, key-free denial/error counts in logs. Run two app processes against the same database in the acceptance test so a process-local cache cannot accidentally pass.

## Candidate initial policy for review

| Surface | Key and candidate window | Why |
| --- | --- | --- |
| Respondent and researcher email link, shared across both start routes | 5 attempts per normalized email in 15 minutes; 120 attempts per trusted source in 15 minutes | The email cap protects one inbox even across routes or source changes; the larger source cap limits address spraying while allowing a shared campus network. |
| Signed audio upload reservation | 20 attempts per respondent in 15 minutes; 120 attempts per trusted source in 15 minutes | Allows a short interview and ordinary retries while bounding signed URL and reservation creation. Direct object transfer needs separate storage limits. |

These are starting values, not a production policy. Review legitimate cohort concurrency, accessibility retries, and provider quotas before enabling them. Responses should remain generic across known and unknown email accounts; rejected requests use 429 and a bounded `Retry-After` without exposing which key was exhausted. Do not log an address, IP, respondent ID, raw digest, signed URL, or quota balance.

## Key derivation and ingress trust

Normalize email with the existing `normalizeEmail` implementation. Derive separate, versioned HMAC-SHA256 digests for `email`, `source`, and `respondent` keys using a dedicated environment secret; never persist plaintext addresses or IPs in the rate table. The source must come from a verified platform ingress value, not an arbitrary client-supplied `X-Forwarded-For` header. Use exact IPv4 and a /64 IPv6 network for source grouping, then HMAC it. If trusted source identification is unavailable, fail closed or use a verified edge limiter; do not trust a spoofable header. Keep old and new HMAC key versions active until all 15-minute windows expire during rotation.

For upload, validate request shape and authenticated respondent identity before checking the account and source quotas, then invoke `reserve_gate1_audio` and `createSignedUploadUrl` only after acceptance. For OTP, validate input and origin, check both quotas, then call `signInWithOtp` while preserving the existing generic response and researcher PKCE behavior. A provider 429 is a separate secondary guard. The test matrix must cover concurrent requests, both app processes, window rollover, distinct accounts behind one source, source changes for one email, store failure, and zero downstream side effects on 429.
