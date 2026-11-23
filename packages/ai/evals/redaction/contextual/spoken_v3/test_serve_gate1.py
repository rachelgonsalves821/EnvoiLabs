from io import BytesIO
import json
from types import SimpleNamespace
import unittest

from qualify import policy_digest
from serve_gate1 import REQUEST_LIMIT, read_text, response, verify_release
from speech_context import Restored


class PrivateBridgeTests(unittest.TestCase):
    def test_release_requires_approved_independence_and_exact_policy(self):
        policy = {"candidate": "synthetic"}
        sha = "a" * 64
        approved = json.dumps({"manifests": [sha]}).encode()
        manifest = {"policy": policy, "provenance": {"independent": True}}
        report = {
            "qualified_recall": True, "independent": True, "manifest_sha256": sha,
            "policy_digest": policy_digest(policy),
        }
        self.assertEqual(verify_release(manifest, report, sha, policy, approved), policy_digest(policy))
        for report_change in ({"qualified_recall": False}, {"manifest_sha256": "b" * 64}, {"policy_digest": "b" * 64}):
            with self.subTest(report_change=report_change), self.assertRaises(ValueError):
                verify_release(manifest, {**report, **report_change}, sha, policy, approved)
        with self.assertRaises(ValueError):
            verify_release(manifest, report, sha, policy, b'{"manifests": []}')

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
