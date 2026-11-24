# Gate 4 readiness evidence

This record is for local preparation on `codex/gate-4-parallel`. No item below closes Gate 4 or permits live launch. Capture environment, revision, date, owner, and linked evidence for each eventual acceptance run.

| Exit check | Local finding on 2026-11-23 | Still needed for acceptance |
| --- | --- | --- |
| Security review | [First-pass OWASP review](security-review.md) and route inventory are recorded. The lockfile audit found two moderate transitive advisories and zero high or critical. PR #113's existing RLS matrix passed in database CI. | Resolve or assess advisories; re-run dependency and full RLS checks after integration, then enforce and test sign-in and upload rate limits. |
| Interview performance | The inspector now reads Next 16 route manifests. On Gate 2's local build it counts 193,631 gzipped bytes in manifest-listed initial chunks, but finds Echo's implementation in an initial chunk despite a 227-byte lazy wrapper. See the [measurement plan](performance-measurement.md). | Separate the actual Echo implementation, inspect browser-requested JS, then measure LCP under 2.5 seconds on the agreed mid-range phone profile. |
| Incident response | Four scoped runbooks are drafted in this directory. | Reconcile each with the final Gate 2 and Gate 3 controls, rehearse recovery with synthetic IDs, and assign an on-call owner. |
| Debt | `docs/DEBT.md` currently has Gate 1 and Gate 2 items, with no Gate 4 tagged row. | Review all debt after integration; Rachel must explicitly accept any remaining Gate 4 item. |
| Requirement evidence | PRD still records many future requirements as not started. | Update the shared PRD after each gate merges, with `Done`, `Cut`, or `Needs decision` and linked evidence. |
| IT-4.1 | Not run; dependencies are unavailable in this checkout. | Full integrated suite green three consecutive runs. |
| IT-4.2 | Synthetic Gate 1 retry-then-fallback and stale-lease checks added locally. Existing Gate 1 database integration also exercises a retry and subsequent fallback. | Add and run integrated LLM no-probe and Tremendous pending/retry chaos cases when those services land; verify hosted recovery separately. |

The standalone bundle inspector includes root and route client chunks from the build manifests. Its result does not establish browser-requested JavaScript, actual Echo transfer timing, or LCP. Its success alone cannot pass the performance budget.
