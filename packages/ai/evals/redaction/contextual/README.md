# Offline contextual redaction evaluation

This evaluation combines the pinned Presidio contact and organization detectors, a local GLiNER ONNX model, and offset-preserving English contact and identity patterns. Run it on synthetic data in a private environment. The evaluator disables network access and writes aggregate scores without copying transcript text into the report. The candidate has no production adapter.

## Reproduce

Use Python 3.12. Install the exact [evaluation dependencies](requirements.txt) into an isolated environment before loading data. Stage these files from the [pinned GLiNER snapshot](https://huggingface.co/knowledgator/gliner-pii-small-v1.0/tree/d21aad5b4a7ec82b3d0970fd1ac74a12c087d85e) in a directory outside Git.

- Place `gliner_config.json`, `tokenizer.json`, `tokenizer_config.json` and `special_tokens_map.json` at the directory root.
- Copy `onnx/model_quint8.onnx` to the same directory as `model_quint8.onnx`. Its expected SHA-256 is `891589426ee96f2748b16439f44fad8c3f97e198e002a6637e58dee989500216`.
- Compare the staged configuration and tokenizer files against the checksums in the scored report before running the evaluator.

From the repository root on macOS or Linux, set `ENVOI_GLINER_MODEL` to the directory that holds the verified assets.

```sh
python -m pip install -r packages/ai/evals/redaction/contextual/requirements.txt
python -B -m unittest discover -s packages/ai/evals/redaction/contextual
PYTHONPATH=packages/ai/evals/redaction \
  python -B packages/ai/evals/redaction/contextual/evaluate.py previous-fresh \
  --previous-ensemble --out development-replay.json
```

On Windows, set `PYTHONPATH` to `packages/ai/evals/redaction` with PowerShell's `$env:PYTHONPATH` and run the same Python command without the environment prefix. `development` selects the original Presidio holdout. Both named inputs were available during development. Their scores provide regression evidence.

The frozen [authored text](independent-reference-text-cases.json) and [recognized text](independent-asr-cases.json) come from the same 150 independently authored fictional speech fixtures. The [holdout manifest](independent-holdout-manifest.json) records their provenance, checksums and recognition losses. Reproduce the frozen scores without resynthesizing the audio.

```sh
PYTHONPATH=packages/ai/evals/redaction \
  python -B packages/ai/evals/redaction/contextual/evaluate.py \
  packages/ai/evals/redaction/contextual/independent-reference-text-cases.json \
  --previous-ensemble --out independent-reference-text-report.json
PYTHONPATH=packages/ai/evals/redaction \
  python -B packages/ai/evals/redaction/contextual/evaluate.py \
  packages/ai/evals/redaction/contextual/independent-asr-cases.json \
  --previous-ensemble --out independent-asr-report.json
```

For another independent holdout, supply a list of cases or an object with a `cases` list. Each case includes `text`, `sensitive` and `evidence`. Each sensitive span has `entity`, `start` and `end`. Each evidence span has `start` and `end`. Offsets are Unicode character indices with an exclusive end. The supported sensitive labels are `phone`, `email`, `person`, `employer`, `address` and `school`. Preserve the source manifest and the pre-transcription references for audio cases.

## Read the score

Complete masking requires every character of a labeled span to be masked. Partial coverage counts as a miss. The report also records clean passages and labeled evidence altered. Assess those separately from the PRD minimum recall. Read the [candidate decision](../../../../../docs/adr/0004-offline-contextual-redaction.md) before using these results.
