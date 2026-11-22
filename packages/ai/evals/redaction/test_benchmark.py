import unittest
from collections import Counter

from benchmark import MASK, score
from holdout import Span, Transcript, build_holdout


class RedactionBenchmarkTests(unittest.TestCase):
    def test_frozen_corpus_sizes_and_valid_annotations(self):
        cases = build_holdout()
        self.assertEqual(len(cases), 100)
        self.assertEqual(len({case.text for case in cases}), 100)
        self.assertEqual(sum(not case.sensitive for case in cases), 20)
        self.assertEqual(Counter(span.entity for case in cases for span in case.sensitive), {
            "phone": 80, "email": 80, "person": 80, "employer": 80, "address": 80, "school": 20,
        })
        for case in cases:
            for span in (*case.sensitive, case.evidence):
                self.assertTrue(0 <= span.start < span.end <= len(case.text))
                self.assertEqual(case.text[span.start:span.end].strip(), case.text[span.start:span.end])

    def test_partial_redaction_does_not_count_as_recalled_and_evidence_loss_counts(self):
        positive = Transcript("1234 abcde xyz ABC DEF", (
            Span("phone", 0, 4), Span("email", 5, 10), Span("person", 11, 14), Span("employer", 15, 18),
        ), Span("evidence", 19, 22))
        clean = Transcript("clean", (), Span("evidence", 0, 5))
        output = {
            positive.text: MASK * 3 + "4 " + MASK * 5 + " " + MASK * 3 + " " + MASK * 3 + " D" + MASK + "F",
            clean.text: "c" + MASK + "ean",
        }
        measured = score([positive, clean], output.__getitem__)
        self.assertEqual(measured["entities"]["phone"]["recall"], 0)
        self.assertEqual(measured["entities"]["phone"]["partially_masked"], 1)
        self.assertEqual(measured["entities"]["email"]["recall"], 1)
        self.assertEqual(measured["clean_transcripts_altered"], 1)
        self.assertEqual(measured["research_evidence_altered"], 2)
        self.assertFalse(measured["meets_prd_numeric_targets"])

    def test_rejects_length_changing_output(self):
        with self.assertRaisesRegex(ValueError, "position-preserving"):
            score(build_holdout(), lambda _: "")


if __name__ == "__main__":
    unittest.main()
