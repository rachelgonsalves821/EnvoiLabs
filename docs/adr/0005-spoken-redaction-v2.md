# ADR 0005 Spoken transcript redaction V2

Status: rejected for researcher publication.

The PRD requires 99% full-span recall for phone numbers and emails, 95% for names and employers, and removal of addresses. V2 improved every measured entity on 272 independently authored, offline-recognized speech excerpts. It missed all four numeric targets and exposed parts of several addresses. Researcher publication remains disabled. [PRD](../PRD.md) · [V1 decision](0004-offline-contextual-redaction.md)

## Candidate

The V2 candidate retains the pinned Presidio and GLiNER components from V1. It adds token-based handling of spoken digits, email separators and street or unit numbers. The rules record spans in original transcript coordinates. An additional model pass uses selectively restored casing and identity boundaries. All spans are validated and mapped back to the original coordinates. No raw transcript text leaves the evaluation machine.

The original 150 Vosk excerpts became development data for V2. The selected variant matched 22/22 phone, 22/22 email and 21/21 address spans there. It improved full name coverage from 5/23 to 8/23, employer coverage from 5/22 to 7/22 and school coverage from 9/22 to 16/22. Both V1 and V2 altered 5/43 evidence spans and 11/24 clean excerpts. Broad capitalization removed more useful evidence and was dropped before independent scoring. [Development scores](../../packages/ai/evals/redaction/contextual/spoken_v2/vosk-development-v2-comparison.json)

## Independent speech results

A separate author sealed 272 fictional excerpts with 41.94 minutes of offline speech across two desktop voices, including dry, band-limited and mild-noise clips. Vosk 0.3.45 with the small US English 0.15 model changed 861 of 6,626 reference words (13.0%). The independently reviewed annotations retained all sensitive and research evidence spans in recognizable form. The author released the recognized data after the V2 source, model and policy were frozen. [Independent provenance](../../packages/ai/evals/redaction/contextual/spoken_v2/independent-provenance.json) · [Freeze manifest](../../packages/ai/evals/redaction/contextual/spoken_v2/frozen-v2.json)

| Entity | V1 fully masked | V2 fully masked | V2 partial | V2 untouched |
| --- | ---: | ---: | ---: | ---: |
| Phone | 55/140 | 82/140 | 19 | 39 |
| Email | 42/140 | 68/140 | 32 | 40 |
| Person | 8/60 | 15/60 | 26 | 19 |
| Employer | 25/60 | 29/60 | 23 | 8 |
| Address | 3/36 | 20/36 | 9 | 7 |
| School | 14/36 | 19/36 | 15 | 2 |

V1 and V2 altered 6/36 evidence spans each. V1 altered 12/36 clean excerpts and V2 altered 14/36. The phone, email and address gains came from the contact rules. Selective contextual restoration added seven fully masked names, four employers and five schools. [Recognized speech scores](../../packages/ai/evals/redaction/contextual/spoken_v2/independent-asr-v2-comparison.json)

## Paired authored text

On the authored references, V2 fully covered 118/140 phones, 101/140 emails, 60/60 names, 59/60 employers, 36/36 addresses and 36/36 school mentions. Both policies altered 12/36 evidence spans. V1 altered 15/36 clean excerpts and V2 altered 17/36. Contact recall already fell short before speech recognition. Name and employer coverage dropped sharply when the same language went through offline speech recognition. [Paired authored-text scores](../../packages/ai/evals/redaction/contextual/spoken_v2/independent-reference-text-v2-comparison.json)

## Failure analysis

An aggregate diagnostic replayed the locked candidate and grouped each scored span using the independent review. It checked the reviewed character offsets against the exact recognized text and reproduced the frozen counts. The analysis did not change candidate rules, thresholds or annotations.

| Entity | Fully masked when recognized wording was retained | Fully masked when recognized wording changed |
| --- | ---: | ---: |
| Phone | 53/65 | 29/75 |
| Email | 39/49 | 29/91 |
| Person | 8/14 | 7/46 |
| Employer | 20/33 | 9/27 |
| Address | 11/11 | 9/25 |
| School | 14/20 | 5/16 |

Phone recognition changes usually kept the same token count. V2 covered 29/73 of those spans and 0/2 compressed spans. Email changes included compression (4/17 fully covered), expansion (5/20), and changes at the same token count (20/54). Expanded names and employers were particularly difficult, with 5/40 names and 0/7 employers fully masked. The candidate also missed six unchanged names and thirteen unchanged employers, which confirms that better word recognition alone leaves a redaction gap. These groups describe observed recognition output and do not estimate results for a future speech model. [Aggregate failure groups](../../packages/ai/evals/redaction/contextual/spoken_v2/independent-asr-v2-diagnostics.json)

## Publication conditions

Use the independent failure analysis to prioritize a contextual model or restoration pass that handles unpunctuated identity mentions and a contact recognizer that handles a wider range of spoken separators and digit formats. Compare against a fully private runtime, track false positives that remove evidence, and freeze the next candidate before scoring any new held-out transcripts. Both V2 lanes are now development evidence. Keep publication closed until an independently passing candidate is validated in the exact private answer processing path. [Offline replay](../../packages/ai/evals/redaction/contextual/spoken_v2/README.md)
