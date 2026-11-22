# Synthetic redaction holdout

Run this offline benchmark in an isolated Python 3.12 environment. The installation step downloads the pinned dependencies and English model. The benchmark uses the installed model and a bundled domain-suffix snapshot. It sends no text to a service.

```text
python -m pip install -r packages/ai/evals/redaction/requirements.txt
python -B -m unittest discover -s packages/ai/evals/redaction
python -B packages/ai/evals/redaction/benchmark.py
```

The 100 fixed synthetic transcripts comprise 80 planted and 20 clean passages. Every planted transcript includes a name, phone, email, address and employer. Twenty also include a school. Covered variations include spoken contacts, lowercasing, initials, postal boxes, apartment and suite markers and useful but harmless numbers and product language. All entities and phrases are fictional or reserved examples. No participant, production or provider output appears in the corpus.

The report compares stock Presidio with the existing supplemental contact patterns. A position-preserving mask counts a hit only when the whole labeled entity is masked. Partial masking and altered useful evidence are counted separately. The script outputs aggregate metrics and dependency versions. The corpus uses repeated construction patterns and simulated recognition errors. Keep a separate corpus of real speech-to-text outputs from synthetic input for the later publication check.

Run `benchmark.py --strict` to check the PRD's current numeric recall targets. The current supplemented candidate fails. Refer to the [recorded results](holdout-v1-results.json) and the [decision](../../../../docs/adr/0003-presidio-transcript-redaction-evaluation.md).
