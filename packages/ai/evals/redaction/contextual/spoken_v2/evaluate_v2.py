"""Compare reversible speech normalization against the pinned offline V1 baseline."""

import argparse
from hashlib import sha256
import json
from math import ceil
import os
from pathlib import Path
from time import perf_counter

from evaluate import (
    GLiNER, LABELS, MODEL, PACKAGES, RECALL_TARGETS, REVISION, THRESHOLD,
    SessionOptions, add_contact_patterns, candidate_analyzer, coverage, version,
)
import candidate
from candidate import Hit, candidate_hits, mask
from speech_context import explicit_identities, restore_for_model
from spoken_contact import spoken_contact_hits


_IDENTITY_LABELS = ["name", "organization", "organization educational"]
_POLICIES = ("v1", "v1_with_spoken_contacts", "v2_selective", "v2_broad")
_THRESHOLD = 0.5
_ONNX_SHA = "891589426ee96f2748b16439f44fad8c3f97e198e002a6637e58dee989500216"


def digest(path):
    hasher = sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def sources():
    here = Path(__file__).resolve().parent
    paths = [here / name for name in ("evaluate_v2.py", "spoken_contact.py", "speech_context.py")]
    paths += [Path(candidate.__file__), Path(candidate.__file__).with_name("evaluate.py")]
    return {item.name: digest(item) for item in paths}


def predict(model, text, labels):
    for hit in model.predict_entities(text, labels, threshold=_THRESHOLD):
        start, end = hit["start"], hit["end"]
        if not 0 <= start < end <= len(text) or text[start:end] != hit["text"]:
            raise RuntimeError("Context recognizer returned an invalid source span")
        yield Hit(hit["label"], start, end)


def model_identities(model, original, explicit, broad):
    restored = restore_for_model(original, explicit, broad=broad)
    for hit in predict(model, restored.text, _IDENTITY_LABELS):
        projected = restored.project(hit.start, hit.end, hit.label)
        if projected:
            yield projected


def run(corpus, requested):
    source_hashes = sources()
    corpus_hash = digest(corpus)
    rows = json.loads(corpus.read_text(encoding="utf-8-sig"))["cases"]
    if not rows:
        raise ValueError("Evaluation requires at least one transcript")
    model_root = Path(os.environ["ENVOI_GLINER_MODEL"]).resolve(strict=True)
    model_file = model_root / "model_quint8.onnx"
    artifacts = {item.name: digest(item) for item in sorted(model_root.iterdir()) if item.is_file()}
    if artifacts.get(model_file.name) != _ONNX_SHA:
        raise ValueError("Local model does not match the pinned ONNX SHA-256")
    options = SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    model = GLiNER.from_pretrained(
        model_root, local_files_only=True, map_location="cpu", runtime="onnxruntime",
        runtime_model_file=model_file.name, runtime_options={"session_options": options},
    )
    analyzer = candidate_analyzer()
    add_contact_patterns(analyzer)
    reports = {
        policy: {"entities": {}, "clean_transcripts": 0, "clean_transcripts_altered": 0,
                 "evidence_spans": 0, "evidence_spans_altered": 0, "research_evidence_altered": 0}
        for policy in requested
    }
    durations = {policy: [] for policy in requested}
    for row in rows:
        original = row["text"]
        started = perf_counter()
        pres = analyzer.analyze(text=original, language="en", score_threshold=THRESHOLD,
                                entities=["PHONE_NUMBER", "EMAIL_ADDRESS", "ORGANIZATION"])
        raw = tuple(predict(model, original, LABELS))
        pinned = tuple(candidate_hits(original, (Hit(hit.entity_type, hit.start, hit.end) for hit in pres), raw))
        baseline_time = perf_counter() - started
        started = perf_counter()
        spoken = tuple(spoken_contact_hits(original))
        explicit = tuple(explicit_identities(original))
        spoken_time = perf_counter() - started
        for policy, report in reports.items():
            started = perf_counter()
            if policy == "v1":
                hits, shared_time = pinned, baseline_time
            elif policy == "v1_with_spoken_contacts":
                hits, shared_time = (*pinned, *spoken), baseline_time + spoken_time
            else:
                restored = model_identities(model, original, explicit, broad=policy == "v2_broad")
                hits = (*pinned, *spoken, *restored)
                shared_time = baseline_time + spoken_time
            output = mask(original, hits)
            durations[policy].append(1000 * (shared_time + perf_counter() - started))
            coverage(row, output, report)
    for policy, report in reports.items():
        for counts in report["entities"].values():
            counts["recall"] = counts["fully_masked"] / counts["planted"]
        report["meets_prd_numeric_targets"] = all(
            report["entities"].get(entity, {}).get("recall", 0) >= target for entity, target in RECALL_TARGETS.items()
        )
        report["p95_ms"] = round(sorted(durations[policy])[ceil(len(rows) * 0.95) - 1], 1)
    if sources() != source_hashes or digest(corpus) != corpus_hash:
        raise RuntimeError("Source or corpus changed during the run")
    return {"corpus_sha256": corpus_hash, "transcripts": len(rows), "sources": source_hashes,
            "model": MODEL, "revision": REVISION, "artifacts": artifacts, "packages": {p: version(p) for p in PACKAGES},
            "threshold": _THRESHOLD, "prd_numeric_targets": RECALL_TARGETS, "policy_results": reports}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("--policy", choices=_POLICIES, action="append")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    report = run(args.corpus, args.policy or _POLICIES)
    data = json.dumps(report, indent=2) + "\n"
    with args.out.open("x", encoding="utf-8") as output:
        output.write(data)
    print(data, end="")


if __name__ == "__main__":
    main()
