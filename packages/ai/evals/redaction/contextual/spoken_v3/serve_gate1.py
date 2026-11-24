"""Private single-answer redaction bridge. Input and output use process pipes only."""

import argparse
import json
from pathlib import Path
import sys

_HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(path) for path in (_HERE.parent / "spoken_v2", _HERE.parent, _HERE.parent.parent)]

from qualify import (
    _APPROVALS, LANES, TARGETS, paired_recall_met, policy_digest, policy_snapshot, verified_json, verify_independence,
)
from asr_casing import LocalCasingModel
from evaluate import ENTITY_CLASSES
from local_detectors import LocalDetectors
from spoken_pipeline import redact


REQUEST_LIMIT = 256 * 1024
RESULT_LIMIT = 512 * 1024


def passing_lane_totals(lane, allow_omissions):
    if not isinstance(lane, dict) or lane.get("recall_passed") is not True:
        return None
    for field in ("cases", "clean_transcripts", "evidence_spans"):
        count = lane.get(field)
        if type(count) is not int or count <= 0:
            return None
    for field, upper in (("clean_transcripts", lane["cases"] - 1), ("withheld_answers", 0),
                         ("withheld_evidence_spans", 0), ("clean_transcripts_altered", lane["clean_transcripts"]),
                         ("evidence_spans_altered", lane["evidence_spans"])):
        count = lane.get(field)
        if type(count) is not int or not 0 <= count <= upper:
            return None
    entities, omissions = lane.get("entities"), lane.get("asr_omitted_entities")
    if (not isinstance(entities, dict) or not isinstance(omissions, dict) or (omissions and not allow_omissions)
            or not TARGETS.keys() <= entities.keys() or (entities.keys() | omissions.keys()) - ENTITY_CLASSES):
        return None
    totals = {}
    for entity in entities.keys() | omissions.keys():
        counts = entities.get(entity, {"planted": 0, "fully_masked": 0, "partially_masked": 0, "unmasked": 0})
        if not isinstance(counts, dict):
            return None
        full, partial, unmasked, planted = (counts.get(field) for field in (
            "fully_masked", "partially_masked", "unmasked", "planted",
        ))
        omitted = omissions.get(entity, 0)
        if (any(type(count) is not int or count < 0 for count in (full, partial, unmasked, planted, omitted))
                or full + partial + unmasked != planted):
            return None
        if entity in TARGETS and (planted == 0 or not paired_recall_met(full, planted, omitted, TARGETS[entity])):
            return None
        totals[entity] = planted + omitted
    return totals


def passing_report_summary(report):
    results = report.get("results")
    if (report.get("controls_present") is not True or report.get("thresholds_percent") != TARGETS
            or not isinstance(results, dict) or set(results) != set(LANES)):
        return False
    authored, recognized = (results[lane] for lane in LANES)
    authored_totals = passing_lane_totals(authored, False)
    recognized_totals = passing_lane_totals(recognized, True)
    return bool(authored_totals and authored_totals == recognized_totals and authored["cases"] == recognized["cases"]
                and authored["clean_transcripts"] == recognized["clean_transcripts"])


def verify_release(manifest, report, manifest_sha, policy, approvals):
    if manifest["policy"] != policy or not verify_independence(manifest["provenance"], manifest_sha, approvals):
        raise ValueError("Redactor policy is unapproved or changed")
    version = policy_digest(policy)
    if (report.get("qualified_recall") is not True or report.get("independent") is not True
            or report.get("manifest_sha256") != manifest_sha or report.get("policy_digest") != version
            or report.get("candidate") != policy["candidate"] or not passing_report_summary(report)):
        raise ValueError("Redactor has no matching qualification")
    return version


def read_text(stream):
    raw = stream.read(REQUEST_LIMIT + 1)
    if len(raw) > REQUEST_LIMIT:
        raise ValueError("Redaction input exceeds the pipe limit")
    payload = json.loads(raw.decode("utf8"))
    if not isinstance(payload, dict) or set(payload) != {"text"} or not isinstance(payload["text"], str):
        raise ValueError("Invalid redaction request")
    if not payload["text"].strip():
        raise ValueError("Empty redaction request")
    return payload["text"]


def response(text, detectors, casing, policy, report_digest):
    rendered = redact(text, detectors.deterministic, detectors.contextual, casing.restore)
    result = json.dumps({
        "protocol": "gate1-redaction-v1", "policyDigest": policy,
        "qualificationDigest": report_digest, "redactedText": rendered,
    }, ensure_ascii=False).encode("utf8")
    if len(result) > RESULT_LIMIT or not rendered.strip():
        raise ValueError("Redaction output is outside the pipe limits")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("manifest", "report", "context-model", "casing-model"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--report-sha256", required=True)
    args = parser.parse_args()
    try:
        policy = policy_snapshot()
        manifest = verified_json(args.manifest, args.manifest_sha256)
        report = verified_json(args.report, args.report_sha256)
        approvals = _APPROVALS.read_bytes()
        version = verify_release(manifest, report, args.manifest_sha256, policy, approvals)
        detectors = LocalDetectors(args.context_model.resolve(strict=True))
        casing = LocalCasingModel(args.casing_model.resolve(strict=True))
        text = read_text(sys.stdin.buffer)
        result = response(text, detectors, casing, version, args.report_sha256)
        if policy_snapshot() != policy or _APPROVALS.read_bytes() != approvals:
            return 1
        sys.stdout.buffer.write(result)
        return 0
    except Exception:
        # The parent receives only a failure status. Never serialize source data or exceptions.
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
