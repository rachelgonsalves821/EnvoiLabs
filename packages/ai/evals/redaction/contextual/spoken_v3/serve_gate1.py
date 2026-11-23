"""Private single-answer redaction bridge. Input and output use process pipes only."""

import argparse
import json
from pathlib import Path
import sys

_HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(path) for path in (_HERE.parent / "spoken_v2", _HERE.parent, _HERE.parent.parent)]

from qualify import _APPROVALS, policy_digest, policy_snapshot, verified_json, verify_independence
from asr_casing import LocalCasingModel
from local_detectors import LocalDetectors
from spoken_pipeline import redact


REQUEST_LIMIT = 256 * 1024
RESULT_LIMIT = 512 * 1024


def verify_release(manifest, report, manifest_sha, policy, approvals):
    if manifest["policy"] != policy or not verify_independence(manifest["provenance"], manifest_sha, approvals):
        raise ValueError("Redactor policy is unapproved or changed")
    version = policy_digest(policy)
    if (report["qualified_recall"] is not True or report["independent"] is not True
            or report["manifest_sha256"] != manifest_sha or report["policy_digest"] != version):
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
