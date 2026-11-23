# Spoken contact recovery development replay

The offline evaluator adds contact recognition to the frozen V2 pipeline. The extra pass uses grouped and repeated digits, international prefixes, and strong phone cues for malformed number runs. It recognizes spoken email separators and bounded handle context when speech recognition joins or drops separators. Each detection masks original transcript offsets with the existing V2 rules.

The comparison also measures a product-label check for contextual model detections. Explicit menu and shop labels can stay in the transcript when the nearby language and mapped spans give no private identity cue. Contact rules and deterministic matches keep their masks across both policies.

Use the same Python packages and pinned local model as the [V2 replay](../spoken_v2/README.md). From this directory, set `ENVOI_GLINER_MODEL` to the validated model folder and `ENVOI_SPOKEN_KNOWN` to the 272-excerpt corpus used by V2. Its former holdout has already been reviewed and is now development data.

```sh
export PYTHONPATH="../spoken_v2:..:../..${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONHASHSEED=0
python -B -m unittest discover -v
python -B compare_contact_recovery.py ../independent-asr-cases.json contact-recovery-first.json
python -B compare_contact_recovery.py "$ENVOI_SPOKEN_KNOWN/asr-cases.json" contact-recovery-known.json
python -B compare_contact_recovery.py "$ENVOI_SPOKEN_KNOWN/reference-text-cases.json" contact-recovery-authored.json
```

The output path must be unused. The evaluator checks the corpus and records source checksums, latency and aggregate coverage. Use fresh independently annotated speech for qualification after the next candidate is frozen.

### Casing and punctuation comparison

Stage `config.json`, `tokenizer.json` and `onnx/model_quantized.onnx` together in a local folder, placing the ONNX file at the folder root. The evaluator verifies all three checksums from the pinned Apache-2.0 release. The extra pass runs locally and projects model detections back to the original transcript positions. [Pinned model files](https://huggingface.co/Horizon-Labs/multilingual-punctuation-truecase-small/tree/a527b62e5a3e16de7e316f03234c99422b1c8814)

The comparison reports a boundary policy that can complete a detected identity with adjacent cased words or a corroborated explicit identity span. It keeps the individual casing policies available as baselines.

The person-slot comparison also tests fragmented names within bounded naming, signing and attribution phrases. Ambiguous slots need casing or a corroborating person detection. The resulting masks keep the original speech offsets.

The contact-slot comparison measures short internal gaps and alternate final digits after explicit phone cues, with separate guards for order and product identifiers.

The email comparison measures split suffixes, missing separators and suffixes fused to host names. It runs on authored or recognized excerpts and checks masks in original source coordinates.

The optional casing replay includes a public-site comparison. It tests whether contextual masks can preserve explicit website and product labels while retaining contact masks and identities supported by private cues.

The employment comparison measures bounded organizations in explicit employment, payroll and workplace-field clauses, with separate cases to distinguish shift times and unrelated businesses.

The confirmed-name comparison measures fragmented personal names bounded by clear record fields or explicit name confirmations.

The commercial-reference comparison measures whether contextual detections can preserve explicit item labels, generic shop references and ordinary idioms. Deterministic masks and corroborated private identity spans still take precedence.

The address comparison follows bounded private location and delivery cues. It tests noisy spoken house numbers, missing or fragmented street suffixes and consecutive unit fields. Generic directions require a recognized street suffix. The new masks keep the original transcript offsets.

`spoken_pipeline.py` owns the source spans for every comparison. The scorer uses a fixed-width mask for those spans. The private synthetic entry point renders the latest development spans as `[redacted]` and rejects invalid offsets or casing transformations that change source length.

The evaluator and private synthetic renderer can use the same `LocalDetectors` from `local_detectors.py` and `LocalCasingModel` from `asr_casing.py`. The model directory must contain exactly the five pinned contextual files. The loader checks every digest before inference. It rejects input if the contextual or casing models cannot read all of it. The evaluator records model hashes, policy source hashes and installed package versions. The live worker still needs a qualified policy, controlled long-answer handling and a verified private deployment before publication.

```sh
python -B compare_contact_recovery.py "$ENVOI_SPOKEN_KNOWN/asr-cases.json" \
  contact-recovery-casing.json --casing-model "$ENVOI_CASING_MODEL"
```
