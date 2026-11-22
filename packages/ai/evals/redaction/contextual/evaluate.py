"""Replay a pinned offline ensemble and score full sensitive span coverage."""

import argparse
import json
import os
import sys
from hashlib import sha256
from importlib.metadata import version
from math import ceil
from pathlib import Path
from time import perf_counter

_SOURCE_PATH = Path(__file__).with_name("candidate.py")
_SOURCE_SHA = sha256(_SOURCE_PATH.read_bytes()).hexdigest()
_EVALUATOR_SHA = sha256(Path(__file__).read_bytes()).hexdigest()
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"


def deny_network(event, _):
    if event in {"socket.connect", "socket.getaddrinfo"}:
        raise RuntimeError("Network disabled for offline redaction evaluation.")


sys.addaudithook(deny_network)

from gliner import GLiNER
from onnxruntime import SessionOptions
from presidio_anonymizer.entities import ConflictResolutionStrategy

from benchmark import ANONYMIZER, MASK, MASK_OPERATOR, THRESHOLD, RECALL_TARGETS, add_contact_patterns, candidate_analyzer
from candidate import Hit, candidate_hits, mask
from holdout import build_holdout


LABELS = ["person", "organization", "phone number", "email address", "address"]
ENTITY_CLASSES = {"phone", "email", "person", "employer", "address", "school"}
MODEL = "knowledgator/gliner-pii-small-v1.0"
REVISION = "d21aad5b4a7ec82b3d0970fd1ac74a12c087d85e"
PACKAGES = ("gliner", "onnxruntime", "transformers", "torch", "presidio-analyzer", "presidio-anonymizer", "spacy", "en-core-web-sm", "phonenumbers", "tldextract")


def normalized_rows(corpus):
    if corpus == "development":
        cases = build_holdout()
    elif corpus == "previous-fresh":
        from fresh_context_holdout import build_fresh_holdout
        cases = build_fresh_holdout()
    else:
        data = json.loads(Path(corpus).read_text(encoding="utf-8-sig"))
        return data["cases"] if isinstance(data, dict) else data
    return [{
        "text": case.text,
        "sensitive": [vars(span) for span in case.sensitive],
        "evidence": [vars(case.evidence)],
    } for case in cases]


def coverage(row, output, aggregate):
    text = row["text"]
    sensitive = row["sensitive"]
    evidence = row["evidence"]
    if not isinstance(evidence, list):
        evidence = [evidence]
    if not isinstance(text, str) or len(text) != len(output) or MASK in text:
        raise ValueError("Mask must preserve original source offsets")
    for span in [*sensitive, *evidence]:
        if not 0 <= span["start"] < span["end"] <= len(text):
            raise ValueError("Fixture has an invalid character span")
    if not sensitive:
        aggregate["clean_transcripts"] += 1
        aggregate["clean_transcripts_altered"] += text != output
    changed = sum(output[span["start"]:span["end"]] != text[span["start"]:span["end"]] for span in evidence)
    aggregate["evidence_spans"] += len(evidence)
    aggregate["evidence_spans_altered"] += changed
    aggregate["research_evidence_altered"] += changed > 0
    for span in sensitive:
        entity, start, end = span["entity"], span["start"], span["end"]
        if entity not in ENTITY_CLASSES:
            raise ValueError(f"Unknown fixture entity type: {entity}")
        counts = aggregate["entities"].setdefault(entity, {"planted": 0, "fully_masked": 0, "partially_masked": 0})
        value = output[start:end]
        full = value == MASK * (end - start)
        counts["planted"] += 1
        counts["fully_masked"] += full
        counts["partially_masked"] += not full and MASK in value


def run(rows, baseline_mode):
    root = Path(os.environ["ENVOI_GLINER_MODEL"]).resolve(strict=True)
    model_file = root / "model_quint8.onnx"
    options = SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    context = GLiNER.from_pretrained(
        root, local_files_only=True, map_location="cpu",
        runtime="onnxruntime", runtime_model_file=model_file.name,
        runtime_options={"session_options": options},
    )
    deterministic = candidate_analyzer()
    add_contact_patterns(deterministic)
    keys = ("previous_contact_ensemble", "candidate") if baseline_mode else ("candidate",)
    reports = {key: {"entities": {}, "clean_transcripts": 0, "clean_transcripts_altered": 0,
                    "evidence_spans": 0, "evidence_spans_altered": 0, "research_evidence_altered": 0}
               for key in keys}
    durations = []
    for row in rows:
        text = row["text"]
        started = perf_counter()
        model = context.predict_entities(text, LABELS, threshold=0.5)
        durations.append((perf_counter() - started) * 1000)
        if any(not 0 <= hit["start"] < hit["end"] <= len(text)
               or text[hit["start"]:hit["end"]] != hit["text"] for hit in model):
            raise RuntimeError("Context recognizer returned an invalid source span")
        recognized = deterministic.analyze(
            text=text, language="en", entities=["PHONE_NUMBER", "EMAIL_ADDRESS", "ORGANIZATION"], score_threshold=THRESHOLD,
        )
        contextual = [Hit(hit["label"], hit["start"], hit["end"]) for hit in model]
        deterministic_hits = [Hit(hit.entity_type, hit.start, hit.end) for hit in recognized]
        coverage(row, mask(text, candidate_hits(text, deterministic_hits, contextual)), reports["candidate"])
        if baseline_mode:
            from presidio_analyzer import RecognizerResult
            from contact_patterns_dev import contact_results
            identity = [RecognizerResult(hit["label"], hit["start"], hit["end"], float(hit["score"])) for hit in model
                        if hit["label"] in {"person", "organization"}]
            previous = ANONYMIZER.anonymize(
                text=text, analyzer_results=[*recognized, *contact_results(text), *identity], operators=MASK_OPERATOR,
                conflict_resolution=ConflictResolutionStrategy.REMOVE_INTERSECTIONS,
            ).text
            coverage(row, previous, reports["previous_contact_ensemble"])

    for report in reports.values():
        for counts in report["entities"].values():
            counts["recall"] = counts["fully_masked"] / counts["planted"]
        report["meets_prd_numeric_targets"] = all(
            report["entities"].get(entity, {}).get("recall", 0) >= target for entity, target in RECALL_TARGETS.items()
        )
    if sha256(_SOURCE_PATH.read_bytes()).hexdigest() != _SOURCE_SHA \
            or sha256(Path(__file__).read_bytes()).hexdigest() != _EVALUATOR_SHA:
        raise RuntimeError("Candidate or evaluator changed during the run")
    return {
        "model": MODEL, "revision": REVISION,
        "artifacts": {item.name: sha256(item.read_bytes()).hexdigest() for item in sorted(root.iterdir()) if item.is_file()},
        "packages": {name: version(name) for name in PACKAGES},
        "candidate_sha256": _SOURCE_SHA, "evaluator_sha256": _EVALUATOR_SHA,
        "text_corpus_sha256": sha256(json.dumps(rows, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
        "transcripts": len(rows), "model_labels": LABELS, "model_threshold": 0.5, "deterministic_threshold": THRESHOLD,
        "contextual_p95_ms": round(sorted(durations)[ceil(len(rows) * 0.95) - 1], 1),
        "prd_numeric_targets": RECALL_TARGETS, **reports,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus")
    parser.add_argument("--previous-ensemble", action="store_true")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    result = run(normalized_rows(args.corpus), args.previous_ensemble)
    result["corpus"] = args.corpus
    data = json.dumps(result, indent=2) + "\n"
    if args.out:
        with args.out.open("x", encoding="utf8") as report:
            report.write(data)
    print(data, end="")


if __name__ == "__main__":
    main()
