# Spoken contact recovery development replay

The offline evaluator adds contact recognition to the frozen V2 pipeline. The extra pass uses grouped and repeated digits, international prefixes, and strong phone cues for malformed number runs. It recognizes spoken email separators and bounded handle context when speech recognition joins or drops separators. Each detection masks original transcript offsets with the existing V2 rules.

Use the same Python packages and pinned local model as the [V2 replay](../spoken_v2/README.md). From this directory, set `ENVOI_GLINER_MODEL` to the validated model folder and `ENVOI_SPOKEN_KNOWN` to the 272-excerpt corpus used by V2. Its former holdout has already been reviewed and is now development data.

```sh
export PYTHONPATH="../spoken_v2:..:../..${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONHASHSEED=0
python -B -m unittest discover -v
python -B compare_contact_recovery.py ../independent-asr-cases.json contact-recovery-first.json
python -B compare_contact_recovery.py "$ENVOI_SPOKEN_KNOWN/asr-cases.json" contact-recovery-known.json
```

The output path must be unused. The evaluator checks the corpus and records source checksums, latency and aggregate coverage. Use fresh independently annotated speech for qualification after the next candidate is frozen.
