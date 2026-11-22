"""Offset preservation and spoken contact regressions."""

import unittest

from candidate import Hit, mask
from speech_context import explicit_identities, restore_for_model
from spoken_contact import spoken_contact_hits


class RedactionTests(unittest.TestCase):
    def assertContact(self, text, label, expected):
        match = next(hit for hit in spoken_contact_hits(text) if hit.label == label)
        self.assertEqual(text[match.start:match.end], expected)

    def test_spoken_phone_keeps_full_source_run(self):
        self.assertContact("please call me at two one too five five five oh one ate four thanks", "phone",
                           "two one too five five five oh one ate four")

    def test_email_operators_keep_source_offsets(self):
        self.assertContact("email is jules underscore lee at postcard dot test then i paid", "email",
                           "jules underscore lee at postcard dot test")

    def test_spoken_street_and_unit_are_one_span(self):
        self.assertContact("deliver it to three hundred poppy lane unit five b before dinner", "address",
                           "three hundred poppy lane unit five b")

    def test_receipt_reference_and_cost_are_preserved(self):
        original = "the order reference two one two five five five oh one eight four and the service was good"
        self.assertEqual(mask(original, spoken_contact_hits(original)), original)

    def test_identity_segmentation_projects_across_inserted_punctuation(self):
        original = "my name is étienne noël and i waited"
        identities = tuple(explicit_identities(original))
        restored = restore_for_model(original, identities)
        self.assertEqual(restored.text, "My name is Étienne Noël. And i waited")
        start = restored.text.index("Étienne")
        end = restored.text.index(".")
        self.assertEqual(restored.project(start, end + 1, "name"), Hit("name", start, end))
        self.assertIsNone(restored.project(end, end + 1, "name"))

    def test_case_expansion_cannot_change_source_alignment(self):
        restored = restore_for_model("ßara mo", (Hit("person", 0, 7),))
        self.assertEqual(restored.text, "ßara Mo")
        self.assertEqual(restored.offsets, tuple(range(7)))
        with self.assertRaises(ValueError):
            restored.project(-1, 1, "name")


if __name__ == "__main__":
    unittest.main()
