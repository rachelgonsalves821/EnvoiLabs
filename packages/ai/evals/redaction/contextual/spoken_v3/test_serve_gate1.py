from copy import deepcopy
from io import BytesIO
import json
import os
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from candidate import Hit
from qualify import TARGETS, policy_digest, policy_snapshot, session_result
from serve_gate1 import REQUEST_LIMIT, main, read_text, response, verify_release
from speech_context import Restored


def release_fixture():
    policy = {"candidate": "synthetic"}
    sha = "a" * 64
    approved = json.dumps({"manifests": [sha]}).encode()
    manifest = {"policy": policy, "provenance": {"independent": True, "asr": {"provider": "synthetic"}}}
    sensitive = [{"entity": kind, "start": i * 2, "end": i * 2 + 1} for i, kind in enumerate(TARGETS)]
    rows = {
        "private": {"text": "v w x y z", "sensitive": sensitive, "evidence": []},
        "control": {"text": "Useful evidence.", "sensitive": [], "evidence": [{"start": 0, "end": 15}]},
    }
    masks = [Hit(span["entity"], span["start"], span["end"]) for span in sensitive]
    report = session_result(
        policy, manifest["provenance"], rows, rows, lambda text: masks if text == rows["private"]["text"] else (),
        independent_approved=True,
    )
    report.update(manifest_sha256=sha, policy_digest=policy_digest(policy))
    return manifest, report, sha, policy, approved


class PrivateBridgeTests(unittest.TestCase):
    def test_policy_uses_the_interpreter_platform_in_a_minimal_environment(self):
        platform_id = policy_snapshot()["runtime"]["python_platform"]
        with patch.dict(os.environ, {"PROCESSOR_ARCHITECTURE": ""}):
            self.assertEqual(policy_snapshot()["runtime"]["python_platform"], platform_id)

    def test_release_requires_approved_independence_and_exact_policy(self):
        manifest, report, sha, policy, approved = release_fixture()
        self.assertEqual(verify_release(manifest, report, sha, policy, approved), policy_digest(policy))
        for report_change in ({"qualified_recall": False}, {"manifest_sha256": "b" * 64},
                              {"policy_digest": "b" * 64}, {"candidate": "different"}, {"results": {}},
                              {"thresholds_percent": {**TARGETS, "phone": 98}}):
            with self.subTest(report_change=report_change), self.assertRaises(ValueError):
                verify_release(manifest, {**report, **report_change}, sha, policy, approved)
        with self.assertRaises(ValueError):
            verify_release(manifest, report, sha, policy, b'{"manifests": []}')

    def test_pass_flag_cannot_override_failing_or_invalid_lane_counts(self):
        manifest, report, sha, policy, approved = release_fixture()
        for path, value in (
            (("entities", "email", "fully_masked"), 0),
            (("entities", "phone", "fully_masked"), True),
            (("entities", "person", "planted"), 0),
            (("entities", "person", "partially_masked"), 1),
            (("entities", "phone", "unmasked"), -1),
            (("asr_omitted_entities", "address"), 1),
            (("asr_omitted_entities", "person"), -1),
            (("asr_omitted_entities", "unknown"), 1),
            (("withheld_answers",), 1),
            (("withheld_evidence_spans",), 1),
            (("clean_transcripts",), 0),
            (("clean_transcripts",), 3),
            (("evidence_spans",), 0),
            (("cases",), 3),
        ):
            altered = deepcopy(report)
            cursor = altered["results"]["recognized"]
            for field in path[:-1]:
                cursor = cursor[field]
            cursor[path[-1]] = value
            with self.subTest(path=path), self.assertRaises(ValueError):
                verify_release(manifest, altered, sha, policy, approved)

    def test_matching_paired_counts_allow_an_omission_within_the_floor(self):
        manifest, report, sha, policy, approved = release_fixture()
        authored, recognized = (report["results"][lane] for lane in ("authored", "recognized"))
        authored["entities"]["phone"].update(planted=100, fully_masked=100)
        recognized["entities"]["phone"].update(planted=99, fully_masked=99)
        recognized["asr_omitted_entities"]["phone"] = 1
        self.assertEqual(verify_release(manifest, report, sha, policy, approved), policy_digest(policy))
        authored["entities"]["phone"].update(planted=101, fully_masked=101)
        with self.assertRaises(ValueError):
            verify_release(manifest, report, sha, policy, approved)

    def test_optional_entity_can_be_omitted_without_adding_a_recall_floor(self):
        manifest, report, sha, policy, approved = release_fixture()
        authored, recognized = (report["results"][lane] for lane in ("authored", "recognized"))
        authored["entities"]["school"] = {"planted": 1, "fully_masked": 0, "partially_masked": 0, "unmasked": 1}
        recognized["asr_omitted_entities"]["school"] = 1
        self.assertEqual(verify_release(manifest, report, sha, policy, approved), policy_digest(policy))
        for lane in (authored, recognized):
            lane["cases"] = 3
        recognized["clean_transcripts"] = 2
        with self.assertRaises(ValueError):
            verify_release(manifest, report, sha, policy, approved)

    def test_inconsistent_report_stops_before_private_input_or_model_load(self):
        manifest, report, sha, policy, approved = release_fixture()
        report["results"]["recognized"]["entities"]["employer"]["fully_masked"] = 0
        argv = ["serve_gate1.py", "--manifest", "manifest.json", "--manifest-sha256", sha,
                "--report", "report.json", "--report-sha256", "b" * 64,
                "--context-model", "context", "--casing-model", "casing"]
        with (patch.object(sys, "argv", argv), patch("serve_gate1.policy_snapshot", return_value=policy),
              patch("serve_gate1.verified_json", side_effect=(manifest, report)),
              patch("serve_gate1._APPROVALS", SimpleNamespace(read_bytes=lambda: approved)),
              patch("serve_gate1.LocalDetectors") as load_model, patch("serve_gate1.read_text") as private_input):
            self.assertEqual(main(), 1)
            load_model.assert_not_called()
            private_input.assert_not_called()

    def test_pipe_accepts_only_a_single_bounded_text_value(self):
        self.assertEqual(read_text(BytesIO(b'{"text":"synthetic"}')), "synthetic")
        for request in (b'{"text":" "}', b'{"text":"test","other":1}', b'a' * (REQUEST_LIMIT + 1), b'\xff'):
            with self.subTest(length=len(request)), self.assertRaises(ValueError):
                read_text(BytesIO(request))

    def test_result_contains_rendered_text_and_digests_only(self):
        detectors = SimpleNamespace(deterministic=lambda _: (), contextual=lambda *_: ())
        casing = SimpleNamespace(restore=lambda text: Restored(text, tuple(range(len(text)))))
        result = json.loads(response("Email me at synthetic@example.test because the receipt was easy to read.",
                                     detectors, casing, "a" * 64, "b" * 64))
        self.assertEqual(result["redactedText"], "Email me at [redacted] because the receipt was easy to read.")
        self.assertEqual(result["policyDigest"], "a" * 64)
        self.assertEqual(result["qualificationDigest"], "b" * 64)
