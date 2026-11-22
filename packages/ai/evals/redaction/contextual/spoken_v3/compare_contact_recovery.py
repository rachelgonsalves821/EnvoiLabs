"""Replay the frozen V2 pipeline with an additional known-data contact pass."""

import argparse
import json
from math import ceil
import os
from pathlib import Path
from time import perf_counter

from candidate import Hit, candidate_hits, mask
from evaluate import GLiNER, LABELS, SessionOptions, THRESHOLD, add_contact_patterns, candidate_analyzer, coverage
from evaluate_v2 import _ONNX_SHA, digest, model_identities, predict, sources
from speech_context import explicit_identities
from spoken_contact import spoken_contact_hits
from spoken_contacts_recover import recovered_contacts

_KNOWN_CORPORA = {
    "2057f7214368b047d9bb27b87b91cfd41e634182ab3f1feb3135f4d838d6ce85",
    "439cbcd4b105722fc23c25ec0d07329eac4b34ab97e5f76766bb48d769b21724",
}


def frozen_v2_hits(text, analyzer, model):
    presidio = analyzer.analyze(
        text=text, language="en", score_threshold=THRESHOLD,
        entities=["PHONE_NUMBER", "EMAIL_ADDRESS", "ORGANIZATION"],
    )
    raw = tuple(predict(model, text, LABELS))
    baseline = tuple(candidate_hits(text, (Hit(hit.entity_type, hit.start, hit.end) for hit in presidio), raw))
    spoken = tuple(spoken_contact_hits(text))
    explicit = tuple(explicit_identities(text))
    return (*baseline, *spoken, *model_identities(model, text, explicit, broad=False))


def report_template():
    return {
        "entities": {}, "clean_transcripts": 0, "clean_transcripts_altered": 0,
        "evidence_spans": 0, "evidence_spans_altered": 0, "research_evidence_altered": 0,
    }


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("cases", type=Path)
    args.add_argument("output", type=Path)
    opts = args.parse_args()
    corpus_sha = digest(opts.cases)
    if corpus_sha not in _KNOWN_CORPORA:
        raise ValueError("Expected the already evaluated, known synthetic corpus")
    source = Path(__file__)
    source_sha = digest(source)
    rules = Path(__file__).with_name("spoken_contacts_recover.py")
    rules_sha = digest(rules)
    rows = json.loads(opts.cases.read_text(encoding="utf-8-sig"))["cases"]
    model_root = Path(os.environ["ENVOI_GLINER_MODEL"]).resolve(strict=True)
    model_file = model_root / "model_quint8.onnx"
    if digest(model_file) != _ONNX_SHA:
        raise ValueError("Expected the frozen V2 model")
    frozen_sources = sources()
    options = SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    model = GLiNER.from_pretrained(
        model_root, local_files_only=True, map_location="cpu", runtime="onnxruntime",
        runtime_model_file=model_file.name, runtime_options={"session_options": options},
    )
    analyzer = candidate_analyzer()
    add_contact_patterns(analyzer)
    results = {mode: report_template() for mode in ("frozen_v2", "v2_plus_contact_recovery")}
    times = []
    for row in rows:
        text = row["text"]
        base = frozen_v2_hits(text, analyzer, model)
        start = perf_counter()
        additional = tuple(recovered_contacts(text))
        times.append(perf_counter() - start)
        coverage(row, mask(text, base), results["frozen_v2"])
        coverage(row, mask(text, (*base, *additional)), results["v2_plus_contact_recovery"])
    if (sources() != frozen_sources or digest(rules) != rules_sha
            or digest(source) != source_sha or digest(opts.cases) != corpus_sha):
        raise RuntimeError("The evaluation sources or corpus changed during the run")
    report = {
        "cases": len(rows), "source_sha256": source_sha,
        "contact_rules_sha256": rules_sha,
        "additional_pass_p95_ms": round(1000 * sorted(times)[ceil(0.95 * len(times)) - 1], 3),
        "corpus_sha256": corpus_sha, "v2_sources": frozen_sources, "results": results,
    }
    with opts.output.open("x", encoding="utf8") as stream:
        stream.write(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
