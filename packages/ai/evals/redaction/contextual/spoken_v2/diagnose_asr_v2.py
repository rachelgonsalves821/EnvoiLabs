"""Group frozen speech-evaluation outcomes by independently reviewed ASR changes."""

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import re

import evaluate_v2 as evaluator


MASK = "\uE000"
WORD = re.compile(r"\b\w+\b")


def recognition_group(annotation):
    status = annotation["status"]
    if status == "retained":
        return status
    if status != "changed":
        raise ValueError("Only retained or changed realized spans can be scored")
    observed = annotation["observed"]["text"]
    difference = len(WORD.findall(observed)) - len(WORD.findall(annotation["reference"]))
    if difference < 0:
        return "changed_fewer_tokens"
    if difference > 0:
        return "changed_more_tokens"
    return "changed_equal_token_count"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("paired_review", type=Path)
    parser.add_argument("primary_report", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    expected = json.loads(args.primary_report.read_text(encoding="utf8"))
    pairs_hash = evaluator.digest(args.paired_review)
    if evaluator.digest(args.corpus) != expected["corpus_sha256"] or evaluator.sources() != expected["sources"]:
        raise ValueError("Diagnostics require the original frozen replay inputs")
    annotations = {}
    for line in args.paired_review.read_text(encoding="utf-8-sig").splitlines():
        row = json.loads(line)
        for annotation in row["reviewed_spans"]:
            key = row["id"], annotation["kind"]
            if key in annotations:
                raise ValueError("Diagnostic requires a unique reviewed entity per excerpt")
            annotations[key] = annotation

    buckets = defaultdict(lambda: defaultdict(Counter))
    original_coverage = evaluator.coverage

    def observe(row, output, aggregate):
        original_coverage(row, output, aggregate)
        for span in row["sensitive"]:
            label, start, end = span["entity"], span["start"], span["end"]
            annotation = annotations.pop((row["id"], label))
            observed = annotation["observed"]
            if (observed["start"], observed["end"], observed["text"]) != (start, end, row["text"][start:end]):
                raise ValueError("Reviewed span does not match the scored ASR source")
            masked = output[start:end].count(MASK)
            outcome = "full" if masked == end - start else "partial" if masked else "untouched"
            buckets[label][recognition_group(annotation)][outcome] += 1

    evaluator.coverage = observe
    run = evaluator.run(args.corpus, ["v2_selective"])
    actual = run["policy_results"]["v2_selective"]
    locked = expected["policy_results"]["v2_selective"]
    if any(key != "p95_ms" and actual[key] != value for key, value in locked.items()):
        raise RuntimeError("Diagnostic replay did not match the frozen evaluation")
    if any(label != "evidence" for _, label in annotations) or evaluator.digest(args.paired_review) != pairs_hash:
        raise RuntimeError("Diagnostic left a sensitive review unmatched or the paired input changed")
    result = {"corpus_sha256": run["corpus_sha256"], "paired_review_sha256": pairs_hash,
              "frozen_primary_report_sha256": evaluator.digest(args.primary_report), "entity_buckets": buckets}
    data = json.dumps(result, indent=2, sort_keys=True) + "\n"
    with args.out.open("x", encoding="utf8") as report:
        report.write(data)
    print(data, end="")


if __name__ == "__main__":
    main()
