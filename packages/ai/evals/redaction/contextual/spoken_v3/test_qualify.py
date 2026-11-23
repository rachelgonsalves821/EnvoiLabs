import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from candidate import Hit
from qualify import TARGETS, check_pairs, digest, indexed_rows, score, session_result, verified_json, verify_independence


def fixture(key="case", entities=tuple(TARGETS)):
    text = "abc def ghi jkl mno Evidence"
    return {
        "id": key, "text": text,
        "sensitive": [{"entity": entity, "start": i * 4, "end": i * 4 + 3} for i, entity in enumerate(entities)],
        "evidence": [{"start": 20, "end": len(text)}],
    }


def full_detection(_):
    return (Hit(entity, i * 4, i * 4 + 3) for i, entity in enumerate(TARGETS))


class QualificationTests(unittest.TestCase):
    def test_requires_the_precommitted_artifact_hash(self):
        with TemporaryDirectory() as directory:
            source = Path(directory) / "input.json"
            data = b'{"synthetic": true}'
            source.write_bytes(data)
            self.assertEqual(verified_json(source, digest(data)), {"synthetic": True})
            with self.assertRaises(ValueError):
                verified_json(source, "0" * 64)

    def test_rejects_duplicate_case_ids_and_untracked_recognition_omissions(self):
        row = fixture()
        with self.assertRaises(ValueError):
            indexed_rows({"cases": [row, row]}, False)
        observed = {**row, "sensitive": row["sensitive"][1:]}
        with self.assertRaises(ValueError):
            check_pairs({"case": row}, {"case": observed})
        observed["omitted_entities"] = [row["sensitive"][0]["entity"]]
        check_pairs({"case": row}, {"case": observed})

    def test_withheld_answers_count_as_unmasked_without_exposing_details(self):
        def failure(_):
            raise RuntimeError("PRIVATE_INPUT_SENTINEL")

        report = score({"case": fixture()}, failure)
        self.assertEqual(report["withheld_answers"], 1)
        self.assertEqual(report["withheld_evidence_spans"], 1)
        self.assertEqual(report["entities"]["phone"]["unmasked"], 1)
        self.assertFalse(report["recall_passed"])
        self.assertNotIn("PRIVATE_INPUT_SENTINEL", json.dumps(report))

    def test_partial_span_and_absent_category_cannot_pass(self):
        partial = score({"case": fixture()}, lambda _: [Hit("address", 16, 17)])
        self.assertEqual(partial["entities"]["address"]["partially_masked"], 1)
        self.assertFalse(partial["thresholds_met"]["address"])
        self.assertFalse(score({"case": fixture(entities=("phone",))}, full_detection)["recall_passed"])

    def test_asr_omission_does_not_count_as_a_clean_control(self):
        row = {**fixture(entities=()), "omitted_entities": ["email"]}
        report = score({"case": row}, lambda _: [Hit("person", 0, 3)])
        self.assertEqual(report["asr_omitted_entities"], {"email": 1})
        self.assertEqual(report["clean_transcripts"], 0)
        self.assertEqual(report["clean_transcripts_altered"], 0)

    def test_visible_recall_cannot_hide_recognition_omissions(self):
        rows = {"case": fixture(), "omission": {**fixture(entities=()), "omitted_entities": ["phone"]}}
        report = score(rows, full_detection)
        self.assertTrue(report["thresholds_met"]["phone"])
        self.assertFalse(report["paired_span_coverage_met"]["phone"])
        self.assertFalse(report["recall_passed"])

    def test_caller_cannot_self_approve_independence(self):
        sha = "f" * 64
        approvals = json.dumps({"manifests": [sha]}).encode()
        self.assertFalse(verify_independence({"independent": False}, sha, approvals))
        with self.assertRaises(ValueError):
            verify_independence({"independent": True}, "d" * 64, approvals)
        self.assertTrue(verify_independence({"independent": True}, sha, approvals))

    def test_recognized_and_authored_results_must_both_pass_on_independent_data(self):
        rows = {"case": fixture(), "clean": fixture(key="clean", entities=())}
        provenance = {"asr": {"provider": "local", "model": "synthetic"}, "independent": False}
        arguments = ({"candidate": "candidate"}, provenance, rows, rows, full_detection)
        development = session_result(*arguments)
        self.assertTrue(development["results"]["authored"]["recall_passed"])
        self.assertTrue(development["results"]["recognized"]["recall_passed"])
        self.assertFalse(development["qualified_recall"])
        provenance["independent"] = True
        self.assertFalse(session_result(*arguments)["qualified_recall"])
        self.assertTrue(session_result(*arguments, independent_approved=True)["qualified_recall"])
