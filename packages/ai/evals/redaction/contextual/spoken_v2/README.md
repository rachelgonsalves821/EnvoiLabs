# Frozen spoken redaction V2 replay

Use the dependencies and local model setup in the [contextual redaction README](../README.md). Keep both the `contextual` directory and its parent `redaction` on `PYTHONPATH`. The evaluator imports the V1 recognizers and disables network access. The candidate and data stayed on the evaluation machine during testing.

Verify the [freeze manifest](frozen-v2.json) SHA-256 `fe357098ec083bf18694cfcdc133e3492f8766d52268ad2343757c6a40793d3f`. Match the source and model checksums in the manifest and the package versions in the [development report](vosk-development-v2-comparison.json). The independent corpus files and audio are held locally by the evaluation team. The [provenance manifest](independent-provenance.json) records their checksums, annotations, speech conditions and recognition losses.

Run these commands from this directory with `ENVOI_GLINER_MODEL` set to the pinned local model directory and `ENVOI_SPOKEN_HOLDOUT` set to the sealed local corpus directory. The evaluator requires unused output paths.

```sh
PYTHONPATH="..:../..${PYTHONPATH:+:$PYTHONPATH}" python -B -m unittest -v

export PYTHONPATH="..:../..${PYTHONPATH:+:$PYTHONPATH}"
python -B evaluate_v2.py "$ENVOI_SPOKEN_HOLDOUT/asr-cases.json" \
  --policy v2_selective --policy v1 --policy v1_with_spoken_contacts \
  --out reproduced-asr.json
python -B evaluate_v2.py "$ENVOI_SPOKEN_HOLDOUT/reference-text-cases.json" \
  --policy v2_selective --policy v1 --policy v1_with_spoken_contacts \
  --out reproduced-text.json
python -B diagnose_asr_v2.py "$ENVOI_SPOKEN_HOLDOUT/asr-cases.json" \
  "$ENVOI_SPOKEN_HOLDOUT/paired-reviewed.jsonl" \
  independent-asr-v2-comparison.json reproduced-diagnostics.json
```

To replay development, pass `../independent-asr-cases.json` with no policy flags to compare all four development variants. Compare counts independently of machine-dependent latency. The diagnostic replays only the frozen V2 policy, verifies that its scores match the locked run and records counts grouped by independently reviewed recognition changes. No source transcript strings appear in any report.
