"""Replay the frozen V2 pipeline with an additional known-data contact pass."""

import argparse
from functools import partial
import json
from math import ceil
import os
from pathlib import Path


from asr_casing import LocalCasingModel, MODEL_FILES, MODEL_REVISION
from candidate import Hit, mask
from evaluate import GLiNER, SessionOptions, THRESHOLD, add_contact_patterns, candidate_analyzer, coverage
from evaluate_v2 import _ONNX_SHA, digest, predict, sources
from spoken_pipeline import span_variants

_KNOWN_CORPORA = {
    "2057f7214368b047d9bb27b87b91cfd41e634182ab3f1feb3135f4d838d6ce85",
    "439cbcd4b105722fc23c25ec0d07329eac4b34ab97e5f76766bb48d769b21724",
    "da5da833c729938225762b7de227a7dc742eed4cac88ea6d1835c2e8c8a02b7e",
}


def _deterministic(analyzer, text):
    presidio = analyzer.analyze(
        text=text, language="en", score_threshold=THRESHOLD,
        entities=["PHONE_NUMBER", "EMAIL_ADDRESS", "ORGANIZATION"],
    )
    yield from (Hit(hit.entity_type, hit.start, hit.end) for hit in presidio)


def report_template():
    return {
        "entities": {}, "clean_transcripts": 0, "clean_transcripts_altered": 0,
        "evidence_spans": 0, "evidence_spans_altered": 0, "research_evidence_altered": 0,
    }


def p95(samples):
    return round(1000 * sorted(samples)[ceil(0.95 * len(samples)) - 1], 3)


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("cases", type=Path)
    args.add_argument("output", type=Path)
    args.add_argument("--casing-model", type=Path, help="Run the pinned offline casing experiment on recognized text.")
    opts = args.parse_args()
    corpus_sha = digest(opts.cases)
    if corpus_sha not in _KNOWN_CORPORA:
        raise ValueError("Expected the already evaluated, known synthetic corpus")
    source = Path(__file__)
    source_sha = digest(source)
    candidates = [source.with_name(name) for name in (
        "address_slot_recovery.py", "asr_casing.py", "confirmed_names.py", "email_slot_recovery.py", "employer_slot_recovery.py",
        "identity_boundaries.py",
        "person_slot_recovery.py",
        "phone_slot_recovery.py",
        "product_context.py", "public_website_context.py", "spoken_contacts_recover.py", "spoken_pipeline.py",
    )]
    candidate_hashes = {rule.name: digest(rule) for rule in candidates}
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
    timings = {"contacts": [], "casing": []}
    casing = LocalCasingModel(opts.casing_model) if opts.casing_model else None
    restore = casing.restore if casing else None
    deterministic = partial(_deterministic, analyzer)
    contextual = partial(predict, model)
    results = {}
    for row in rows:
        text = row["text"]
        for name, spans in span_variants(text, deterministic, contextual, restore, timings=timings):
            if name not in results:
                results[name] = report_template()
            coverage(row, mask(text, spans), results[name])
    if (sources() != frozen_sources or {rule.name: digest(rule) for rule in candidates} != candidate_hashes
            or digest(source) != source_sha or digest(opts.cases) != corpus_sha):
        raise RuntimeError("The evaluation sources or corpus changed during the run")
    report = {
        "cases": len(rows), "source_sha256": source_sha,
        "contact_rules_sha256": candidate_hashes["spoken_contacts_recover.py"],
        "product_context_sha256": candidate_hashes["product_context.py"],
        "email_slots_source_sha256": candidate_hashes["email_slot_recovery.py"],
        "confirmed_names_source_sha256": candidate_hashes["confirmed_names.py"],
        "address_slots_source_sha256": candidate_hashes["address_slot_recovery.py"],
        "pipeline_source_sha256": candidate_hashes["spoken_pipeline.py"],
        "employer_slots_source_sha256": candidate_hashes["employer_slot_recovery.py"],
        "website_context_source_sha256": candidate_hashes["public_website_context.py"],
        "additional_pass_p95_ms": p95(timings["contacts"]),
        "corpus_sha256": corpus_sha, "v2_sources": frozen_sources, "results": results,
    }
    if casing:
        report["casing_model"] = {
            "revision": MODEL_REVISION, "asset_sha256": MODEL_FILES,
            "casing_source_sha256": candidate_hashes["asr_casing.py"],
            "boundaries_source_sha256": candidate_hashes["identity_boundaries.py"],
            "person_slots_source_sha256": candidate_hashes["person_slot_recovery.py"],
            "phone_slots_source_sha256": candidate_hashes["phone_slot_recovery.py"],
            "p95_ms": p95(timings["casing"]),
        }
    with opts.output.open("x", encoding="utf8") as stream:
        stream.write(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
