# ADR 0004. Offline contextual redaction candidate

Status. Evaluated for R-PLAT-07 in a private synthetic benchmark. Researcher publication remains disabled.

## Decision

Keep the contextual candidate as an offline evaluation. It combines targeted Presidio detections and a pinned GLiNER ONNX model with contact patterns for numeric and spoken phone numbers, literal and spoken email addresses, delivery addresses, and introductions that identify a person, employer or school. The mask is a union of validated character spans. Overlapping detections keep the original offsets.

## Development replay

The 100 synthetic transcripts below were available while developing the candidate. Their score supports regression testing. [Scored result and reproduction commands](../../packages/ai/evals/redaction/contextual/README.md)

| Entity or measure | Earlier contact and organization ensemble | Frozen candidate |
| --- | --- | --- |
| Phone fully masked | 70/80 | 80/80 |
| Email fully masked | 50/80 | 80/80 |
| Name fully masked | 78/80 | 80/80 |
| Employer fully masked | 67/80 | 80/80 |
| Address fully masked | 50/80 | 80/80 |
| School fully masked | 20/20 | 20/20 |
| Research evidence passages altered | 13/100 | 11/100 |
| Clean passages altered | 8/20 | 7/20 |

The full-span recall improvement includes mixed spoken and written contact formats, lowercased identities introduced by an explicit cue, and street names that contain a suffix word. The candidate still removes useful evidence and alters clean passages. Model-only local p95 was 635.6 ms on this CPU run. This excludes the other detectors and gives no hosted latency estimate.

## Independent authored references

A separate author prepared and locked 150 fictional excerpts. They shared the input after the candidate and scorer were frozen. These are the spoken-form references, before speech recognition. Authoring and masking were performed by different agents. [Authored input](../../packages/ai/evals/redaction/contextual/independent-reference-text-cases.json) · [Scored report](../../packages/ai/evals/redaction/contextual/independent-reference-text-report.json)

| Entity or measure | Earlier ensemble | Frozen candidate |
| --- | --- | --- |
| Phone fully masked | 21/22 | 22/22 |
| Email fully masked | 14/22 | 15/22 |
| Name fully masked | 23/23 | 23/23 |
| Employer fully masked | 22/22 | 22/22 |
| Address fully masked | 1/21 | 7/21 |
| School fully masked | 22/22 | 22/22 |
| Evidence spans altered | 7/45 | 8/45 |
| Clean passages altered | 13/24 | 13/24 |

The candidate missed the email and address requirements on untouched references. Seven email spans and ten address spans were only partially masked. These results already rule out approval. The separate audio evaluation measures what happens after actual recognition.

## Independent recognition

The corpus author rendered the same references through two Windows SAPI voices and ran Vosk 0.3.45 with `vosk-model-small-en-us-0.15` strictly offline. The 787.8 seconds of audio cover dry, band-limited and mild noise conditions. Recognition changed 224 of 2,081 reference words. A separate review aligned sensitive and evidence spans to the unmodified recognized text. All 132 sensitive spans remained recognizable. Two of 45 evidence spans were absent from recognized text, leaving 43 for redaction scoring. [Recognized input](../../packages/ai/evals/redaction/contextual/independent-asr-cases.json) · [Holdout manifest](../../packages/ai/evals/redaction/contextual/independent-holdout-manifest.json)

This speech set measures actual offline recognition. Its synthetic voices and local model do not establish production provider or real-device parity. The measured sample sizes are too small to establish production recall even for categories with no observed miss.

| Entity or measure | Earlier ensemble | Frozen candidate |
| --- | --- | --- |
| Phone fully masked | 12/22 | 13/22 |
| Email fully masked | 7/22 | 8/22 |
| Name fully masked | 5/23 | 5/23 |
| Employer fully masked | 5/22 | 5/22 |
| Address fully masked | 0/21 | 5/21 |
| School fully masked | 10/22 | 9/22 |
| Evidence spans altered | 4/43 | 5/43 |
| Clean passages altered | 10/24 | 11/24 |

The candidate improved contact and address coverage on the recognized text while reducing school recall and altering more useful evidence. Person and employer recall stayed near 22%. The observed recognition changes and longer unpunctuated spans require more than the demonstrated recognizers. The run leaves researcher publication disabled. [Complete ASR score including partial spans](../../packages/ai/evals/redaction/contextual/independent-asr-report.json)

## Source and reproduction

The pinned candidate SHA-256 is `718e85b79a92e208904e799de95aabc86e50ec3a719a289ff415067a64d2dc08`. The scorer SHA-256 is `edc617fd158d44ac21b856f974084cbf3a89d6a83ea3f76afea22ac2b762c688`. The [structured development report](../../packages/ai/evals/redaction/contextual/development-replay.json) records the complete dependency versions, data fingerprint and model asset hashes.

- Presidio 2.2.366, its spaCy engine and the existing English model follow [ADR 0003](0003-presidio-transcript-redaction-evaluation.md).
- GLiNER 0.2.30 ships an Apache 2.0 license. The model publisher declares Apache 2.0 at revision `d21aad5b4a7ec82b3d0970fd1ac74a12c087d85e`. The locally evaluated `model_quint8.onnx` hash matches the publisher's immutable LFS SHA-256. [GLiNER source license](https://github.com/urchade/GLiNER/blob/v0.2.30/LICENSE) · [Pinned model card](https://huggingface.co/knowledgator/gliner-pii-small-v1.0/blob/d21aad5b4a7ec82b3d0970fd1ac74a12c087d85e/README.md)
- The installed ONNX Runtime 1.32.0 package metadata identifies the MIT license and includes a license and third-party notices. The repository adds Envoi's evaluation code and aggregate scores. Model files and runtime packages remain in the private evaluation environment.
- The Vosk API 0.3.45 and the small US English 0.15 model used to produce the independently scored text are Apache 2.0. The model archive checksum is recorded in the holdout manifest. [Vosk source license](https://github.com/alphacep/vosk-api/blob/v0.3.45/COPYING) · [Vosk model list](https://alphacephei.com/vosk/models)

## Publication conditions

Use these failures as development examples for a separately versioned candidate. Prioritize address fragments that include locality or unit details, spoken email handles, and recognizing names and organizations in unpunctuated text. Freeze the next version before a larger independent holdout with paired recognition outputs. Report full-span recall on the realized sensitive spans and recognition loss separately. The PRD requires 99%+ full-span recall for phone numbers and emails, 95%+ for names and employers, and removal of addresses. The contextual pass must also exercise school names and preserve useful evidence.

Keep private processing and researcher-visible publication separate. Before enabling publication, pin and verify the exact private runtime and the complete answer processing path. A missing or failed redaction pass, changed source, or withdrawn consent must withhold publication.
