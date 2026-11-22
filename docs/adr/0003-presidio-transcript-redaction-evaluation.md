# ADR 0003. Presidio transcript redaction evaluation

Status. Evaluated for R-PLAT-07. Both current candidates fail publication criteria.

## Decision

Do not enable researcher transcript publication with stock Presidio or the tested supplemental candidate. Keep the checked-in Presidio setup available for private synthetic evaluation. Evaluate a separate contextual pass and a stronger address and spoken-email detector. Approve a private deployment and verify the complete path before enabling publication.

## Evidence

The frozen holdout used 100 synthetic interview transcripts. Full coverage means the entire annotated span was masked. The supplemental run reused existing rules without tuning them to this corpus. [Benchmark, corpus and reproduction instructions](../../packages/ai/evals/redaction/README.md)

| Entity or measure | Stock Presidio | Supplemental rules | Requirement |
| --- | --- | --- | --- |
| Phone fully masked | 53/80 (66.25%) | 80/80 (100%) | 99%+ |
| Email fully masked | 50/80 (62.5%) | 70/80 (87.5%) | 99%+ |
| Name fully masked | 67/80 (83.75%) | 67/80 (83.75%) | 95%+ |
| Employer fully masked | 67/80 (83.75%) | 67/80 (83.75%) | 95%+ |
| Address fully masked | 0/80 | 40/80 (50%) | Remove addresses |
| School fully masked | 20/20 | 20/20 | Exercise contextual coverage |
| Clean passages altered | 10/20 | 10/20 | Report false positives |
| Useful evidence altered | 50/100 | 50/100 | Report loss of research detail |

The examples cover simulated recognition variations with reused sentence structures. The measured recall belongs to this corpus. Live recognition can introduce additional variations, and the contextual pass remains unevaluated. [Scored results](../../packages/ai/evals/redaction/holdout-v1-results.json)

In the supplemental run, the ten missed email spans all used spoken local-part punctuation. Address misses were split evenly across lowercasing, verbal post-office boxes, floor markers and hash-prefixed unit markers. Lowercasing accounted for nine of the thirteen name misses and twelve of the thirteen employer misses. The clean set contained ten date or time detections along with person and organization detections. Use these errors to guide development, then evaluate on a fresh holdout.

## Source and candidate deployment

Presidio analyzer and anonymizer `2.2.366` correspond to the MIT-licensed revision `211afc337241aee8bf495f282e83ef639a5d015f`. The local benchmark used spaCy `3.8.18` and English model `en_core_web_sm` `3.8.0`. No image was deployed or benchmarked. [Presidio release](https://github.com/data-privacy-stack/presidio/releases/tag/2.2.366) · [License at pinned revision](https://github.com/data-privacy-stack/presidio/blob/211afc337241aee8bf495f282e83ef639a5d015f/LICENSE) · [English model release](https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0)

Official distroless image indexes inspected as candidates for subsequent private parity checks.

- `ghcr.io/data-privacy-stack/presidio-analyzer@sha256:84cb78c12a26d7ff4d2f5b980452dd9983c0a5c8c56ee410226bb6bb3f19f7d8`
- `ghcr.io/data-privacy-stack/presidio-anonymizer@sha256:cf356326f0c9ed1a90b85973976066ff897973d6d495e4f56aa4cba4f351996b`

## Before publication

Run the selected deterministic service and approved contextual pass on fresh labeled inputs, including real speech-to-text outputs from synthetic audio. Review missed contacts, addresses, names, employers and schools, and measure how much useful interview evidence each change removes. Pin the exact private service configuration used in the passing evaluation.

Keep raw audio, text and analyzer output in the restricted worker path. Any failed or pending pass keeps publication closed. IT-1.2 and IT-1.5 must verify consent before processing and publication, stale transcript rejection, and withdrawal during retry. Researcher-facing data should come from the redacted row only after approvals and consent checks pass.
