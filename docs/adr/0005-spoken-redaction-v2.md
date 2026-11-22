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

## Development follow-ups

On 60 known Vosk excerpts, adding a second Whisper Base.en speech pass with same-family corroboration raised full masking of names from 4/15 to 5/15 and schools from 7/15 to 11/15. Employers stayed at 8/15. It altered useful evidence in 2/15 clips and edited 3/15 clean clips, matching V2 on both measures. The extra speech pass took 2.30 seconds at p95.

On 24 known excerpts, an offline Qwen2.5-1.5B Instruct pass added one fully masked school to the frozen V2 output, taking schools from 1/6 to 2/6. Full masking for phone, email, name, employer, and address stayed unchanged. The combined result altered useful evidence in 1/6 clips and edited 1/6 clean clips. The additional pass took 5.26 seconds at p95 including per-clip CLI startup. Both comparisons used known development samples. Qualification still requires an independent holdout.

### Contact formatting during speech recognition

A paired run on 60 known synthetic clips compared Whisper Base.en with and without instructions to format phone numbers as digits and email addresses with standard symbols while preserving the spoken words. Among the 15 clips with each contact type, the recognizer emitted a regex-detectable phone number in 3 clips with the prompt and 4 without it. Neither run emitted a regex-detectable email address. Neither emitted either patterned contact in clips without the corresponding annotation. Contact-clip word edits were 201 with the prompt and 199 without, out of 458 reference words. The p95 decoding time was 2.95 seconds with the prompt and 2.37 seconds without.

This test measured formatting and word edits. It did not verify the correctness of any formed contact value or measure redaction recall. Leave the speech adapter unchanged. This prompt showed no gain on the contact formats that were hardest for V2 to mask.

### Local token classifier

A separate run tested Horizon Labs' Apache-2.0 PII Redactor Base on the same 60 known Vosk transcripts. The pinned ONNX file had SHA-256 `ceaeb170adb26d595d9061fe6be8a63239dd5bbffd23bb135ebd308ea8ceac35`. The model ran locally using two CPU threads, with a 6.18-second load and a p95 of 151.5 ms for tokenization, inference and decoding. [Pinned model](https://huggingface.co/Horizon-Labs/pii-redactor-base/tree/ef0eff8e63c1711ec0c997c5ca9ea3b78a068684)

| Entity | V2 fully masked | Classifier fully masked | Union fully masked |
| --- | ---: | ---: | ---: |
| Phone | 7/15 | 4/15 | 9/15 |
| Email | 8/15 | 0/15 | 8/15 |
| Person | 4/15 | 6/15 | 7/15 |
| Employer | 8/15 | 0/15 | 8/15 |
| Address | 10/15 | 11/15 | 13/15 |
| School | 7/15 | 2/15 | 10/15 |

Address detections incidentally covered some phone fragments. The classifier emitted zero phone labels and one email label. The union modified useful evidence in 3/15 clips and edited 4/15 clean clips, up from 2/15 and 3/15 with V2. These development results leave the contact and identity misses unresolved and do not support adding the classifier to the hosted pipeline.

### Official OpenAI Privacy Filter

The pinned Apache-2.0 Q4 ONNX model ran locally with the publisher's constrained decoder and default calibration. On 272 known Vosk transcripts, adding its detected spans to V2 raised full email masks from 68/140 to 73/140, names from 15/60 to 16/60, and employers from 29/60 to 31/60. Phone, address and school coverage stayed the same. Evidence alterations stayed at 6/36 and clean edits at 14/36. The filter has no dedicated employer or school label. It took 621 ms p95 on two CPU threads and used about 1.25 GB of peak process memory. These development results leave all four recall thresholds unmet. [Pinned model](https://huggingface.co/openai/privacy-filter/tree/7ffa9a043d54d1be65afb281eddf0ffbe629385b) · [Pinned decoder](https://github.com/openai/privacy-filter/blob/f7f00ca7fb869683eb732c010299d901457f19c3/opf/_core/decoding.py)

### Spoken contact recovery

Adding the contact rules to V2 raised full phone masking from 82/140 to 123/140 and full email masking from 68/140 to 112/140 on the same 272 known excerpts. The combined policy edited 6/36 evidence spans and 14/36 clean excerpts, the same counts as V2. The added pass took 1.25 ms p95. On the earlier 150-excerpt corpus, both policies fully masked 22/22 phones and 22/22 emails and altered 5/43 evidence spans and 11/24 clean excerpts. Seven focused tests cover international and repeated digits, contact separators, order references and website context.

Contact coverage remains below the 99% threshold. The development run leaves the independent qualification set available for a future frozen candidate. [Offline evaluator and replay instructions](../../packages/ai/evals/redaction/contextual/spoken_v3/README.md)

### Preserving research labels

The two contextual model passes accounted for all 14 altered clean excerpts and all six altered evidence spans on the 272 known transcripts. A product-label check that preserves explicit menu and shop labels without a nearby private identity cue reduced those counts to 10 and two. Full masking counts stayed the same for all six sensitive categories. On the earlier 150 transcripts, all scored counts were the same with and without this check. The four focused tests cover product labels, an explicit identity span, an employment cue and contact detections.

Raising the model threshold across all detections was less selective. At 0.65, full employer masks dropped from 29 to 17 of 60 and full name masks from 15 to 12 of 60, while one evidence span and one clean excerpt were altered. The product check is a development policy. Its effect on ambiguous titles and private affiliations still needs independent evaluation. [Replay instructions](../../packages/ai/evals/redaction/contextual/spoken_v3/README.md)

## Publication conditions

Use the independent failure analysis to prioritize a contextual model or restoration pass that handles unpunctuated identity mentions and a contact recognizer that handles a wider range of spoken separators and digit formats. Compare against a fully private runtime, track false positives that remove evidence, and freeze the next candidate before scoring any new held-out transcripts. Both V2 lanes are now development evidence. Keep publication closed until an independently passing candidate is validated in the exact private answer processing path. [Offline replay](../../packages/ai/evals/redaction/contextual/spoken_v2/README.md)
