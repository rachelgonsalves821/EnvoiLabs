"""Score a precommitted paired synthetic benchmark against the exact private candidate."""

import argparse
from collections import Counter
from hashlib import sha256
from importlib.metadata import version
import json
from math import ceil
import os
from pathlib import Path
import platform
import re
from time import perf_counter

# The evaluator installs the process-wide offline guard before inference loads.
from evaluate import ENTITY_CLASSES, MASK, PACKAGES, coverage
from asr_casing import LocalCasingModel, MODEL_FILES as CASING_FILES, MODEL_REVISION
from candidate import mask
from compare_contact_recovery import report_template
from local_detectors import LocalDetectors, MODEL_FILES as CONTEXT_FILES
from spoken_pipeline import CANDIDATE, redaction_spans, render_redacted


TARGETS = {"phone": 99, "email": 99, "person": 95, "employer": 95, "address": 100}
LANES = ("authored", "recognized")
_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,127}\Z")
_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent.parent
_APPROVALS = _HERE / "approved-qualification-manifests.json"
_SOURCES = (
    "benchmark.py", "requirements.txt", "contextual/candidate.py", "contextual/evaluate.py",
    "contextual/requirements.txt", "contextual/spoken_v2/speech_context.py",
    "contextual/spoken_v2/spoken_contact.py", "contextual/spoken_v2/evaluate_v2.py",
    *(f"contextual/spoken_v3/{name}.py" for name in (
        "address_slot_recovery", "asr_casing", "compare_contact_recovery", "confirmed_names",
        "email_slot_recovery", "employer_slot_recovery", "identity_boundaries", "local_detectors",
        "person_slot_recovery", "phone_slot_recovery", "product_context", "public_website_context",
        "qualify", "redaction_input", "serve_gate1", "spoken_contacts_recover", "spoken_pipeline",
    )),
)


def digest(data):
    return sha256(data).hexdigest()


def policy_digest(policy):
    return digest(json.dumps(policy, separators=(",", ":"), sort_keys=True).encode("utf8"))


def policy_snapshot():
    return {
        "candidate": CANDIDATE,
        "thresholds_percent": TARGETS,
        "source_sha256": {name: digest((_ROOT / name).read_bytes()) for name in _SOURCES},
        "context_model_sha256": CONTEXT_FILES,
        "casing_model": {"revision": MODEL_REVISION, "asset_sha256": CASING_FILES},
        "runtime": {
            "python": platform.python_version(), "os": platform.system(), "machine": platform.machine(),
            "hash_seed": os.environ.get("PYTHONHASHSEED"),
            "packages": {name: version(name) for name in (*PACKAGES, "tokenizers", "numpy")},
        },
    }


def verified_json(path, expected):
    data = path.read_bytes()
    if digest(data) != expected:
        raise ValueError("Artifact does not match its precommitted digest")
    return json.loads(data.decode("utf-8-sig"))


def verify_independence(provenance, manifest_sha, approval_bytes):
    if not provenance["independent"]:
        return False
    approvals = json.loads(approval_bytes)["manifests"]
    if manifest_sha not in approvals:
        raise ValueError("Independent manifest has no recorded approval")
    return True


def indexed_rows(data, allow_omissions):
    rows = {}
    for row in data["cases"]:
        key, text = row["id"], row["text"]
        if not isinstance(key, str) or not key or key in rows or not isinstance(text, str) or MASK in text:
            raise ValueError("Invalid fixture identity or transcript")
        sensitive, evidence = row["sensitive"], row["evidence"]
        if not isinstance(sensitive, list) or not isinstance(evidence, list):
            raise ValueError("Expected source-coordinate fixture annotations")
        seen = set()
        for span in (*sensitive, *evidence):
            start, end = span["start"], span["end"]
            if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
                raise ValueError("Invalid fixture annotation")
            identity = (start, end, span.get("entity"))
            if identity in seen:
                raise ValueError("Duplicate fixture annotation")
            seen.add(identity)
        omissions = row.get("omitted_entities", [])
        if not isinstance(omissions, list) or (omissions and not allow_omissions):
            raise ValueError("Invalid ASR omission annotations")
        if any(span["entity"] not in ENTITY_CLASSES for span in sensitive) or any(
            item not in ENTITY_CLASSES for item in omissions
        ):
            raise ValueError("Unknown fixture entity")
        rows[key] = row
    if not rows:
        raise ValueError("Empty qualifying dataset")
    return rows


def check_pairs(authored, recognized):
    if authored.keys() != recognized.keys():
        raise ValueError("Authored and recognized case identities differ")
    for key, row in authored.items():
        observed = recognized[key]
        expected = Counter(span["entity"] for span in row["sensitive"])
        actual = Counter(span["entity"] for span in observed["sensitive"]) + Counter(observed.get("omitted_entities", []))
        if expected != actual:
            raise ValueError("ASR annotations must account for every authored sensitive span")


def score(rows, detect):
    result = report_template()
    withheld, evidence_withheld, samples = 0, 0, []
    omissions = Counter()
    for row in rows.values():
        text = row["text"]
        started = perf_counter()
        try:
            spans = tuple(detect(text))
            output = mask(text, spans, character=MASK)
            render_redacted(text, spans)
        except Exception:
            # Report the absent result without serializing exception details or text.
            withheld += 1
            evidence_withheld += len(row["evidence"])
            output = text
        samples.append((perf_counter() - started) * 1000)
        coverage(row, output, result)
        omitted = row.get("omitted_entities", [])
        omissions.update(omitted)
        if omitted and not row["sensitive"]:
            # An ASR omission does not turn a private example into a clean control.
            result["clean_transcripts"] -= 1
            result["clean_transcripts_altered"] -= output != text

    checks, paired_coverage = {}, {}
    for entity, minimum in TARGETS.items():
        counts = result["entities"].get(entity)
        checks[entity] = bool(counts and 100 * counts["fully_masked"] >= minimum * counts["planted"])
        paired_coverage[entity] = bool(counts and
            100 * counts["fully_masked"] >= minimum * (counts["planted"] + omissions[entity]))
    for counts in result["entities"].values():
        counts["unmasked"] = counts["planted"] - counts["fully_masked"] - counts["partially_masked"]
    return {
        **result, "cases": len(rows), "withheld_answers": withheld, "withheld_evidence_spans": evidence_withheld,
        "asr_omitted_entities": dict(omissions), "p95_ms": round(sorted(samples)[ceil(len(samples) * 0.95) - 1], 3),
        "thresholds_met": checks,
        "paired_span_coverage_met": paired_coverage,
        "recall_passed": all(paired_coverage.values()) and not withheld,
    }


def session_result(policy, provenance, authored, recognized, detect, *, independent_approved=False):
    check_pairs(authored, recognized)
    results = {name: score(rows, detect) for name, rows in zip(LANES, (authored, recognized), strict=True)}
    passes = all(result["recall_passed"] for result in results.values())
    controls_present = all(result["clean_transcripts"] and result["evidence_spans"] for result in results.values())
    return {
        "candidate": policy["candidate"], "independent": provenance["independent"],
        "asr": provenance["asr"], "thresholds_percent": TARGETS,
        "results": results, "controls_present": controls_present,
        "qualified_recall": bool(passes and controls_present and independent_approved and provenance["independent"]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    children = parser.add_subparsers(dest="command", required=True)
    children.add_parser("describe-policy", help="Print the candidate and inference pins before fixture access.")
    run = children.add_parser("run", help="Verify declared inputs and write only aggregate scores.")
    for field in ("manifest", "authored", "recognized", "context-model", "casing-model", "output"):
        run.add_argument(f"--{field}", type=Path, required=True)
    run.add_argument("--manifest-sha256", required=True)
    args = parser.parse_args()

    try:
        policy = policy_snapshot()
        if args.command == "describe-policy":
            print(json.dumps(policy, indent=2, sort_keys=True))
            return 0
        manifest = verified_json(args.manifest, args.manifest_sha256)
        provenance = manifest["provenance"]
        asr = provenance["asr"]
        if manifest["policy"] != policy or policy["runtime"]["hash_seed"] != "0":
            raise ValueError("Qualification policy or platform does not match its freeze")
        if type(provenance["independent"]) is not bool or set(asr) != {"provider", "model"} or not all(
            isinstance(value, str) and _IDENTIFIER.fullmatch(value) for value in asr.values()
        ):
            raise ValueError("Invalid qualification provenance")
        approvals = _APPROVALS.read_bytes()
        independent = verify_independence(provenance, args.manifest_sha256, approvals)

        detectors = LocalDetectors(args.context_model.resolve(strict=True))
        casing = LocalCasingModel(args.casing_model.resolve(strict=True))
        authored = indexed_rows(verified_json(args.authored, manifest["corpora"]["authored"]), False)
        recognized = indexed_rows(verified_json(args.recognized, manifest["corpora"]["recognized"]), True)

        def detect(text):
            return redaction_spans(text, detectors.deterministic, detectors.contextual, casing.restore)

        result = session_result(policy, provenance, authored, recognized, detect, independent_approved=independent)
        if policy_snapshot() != policy or _APPROVALS.read_bytes() != approvals:
            raise ValueError("Policy changed during qualification")
        result["manifest_sha256"] = args.manifest_sha256
        result["policy_digest"] = policy_digest(policy)
        result["approval_record_sha256"] = digest(approvals)
        with args.output.open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(result, indent=2, sort_keys=True) + "\n")
        return 0 if result["qualified_recall"] else 1
    except Exception:
        print("Qualification could not verify its policy, artifacts or benchmark annotations.")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
