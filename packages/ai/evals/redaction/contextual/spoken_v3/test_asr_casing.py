import unittest

from asr_casing import restore_word_marks
from candidate import Hit


class CasingOffsetTests(unittest.TestCase):
    def test_project_cased_text_with_inserted_punctuation_back_to_original(self):
        view = restore_word_marks("ana from plum", {3: "0|Cap", 13: ".|Cap"})
        self.assertEqual(view.text, "Ana from Plum.")
        self.assertEqual(view.project(0, 3, "name"), Hit("name", 0, 3))
        self.assertEqual(view.project(9, 14, "organization"), Hit("organization", 9, 13))

    def test_unicode_case_expansion_stays_at_original_length(self):
        view = restore_word_marks("ß and séverine", {1: "0|UPPER", 14: ".|Cap"})
        self.assertEqual(view.text, "ß and Séverine.")
        self.assertEqual(view.project(6, 15, "name"), Hit("name", 6, 14))

    def test_inserted_only_punctuation_does_not_create_a_source_hit(self):
        view = restore_word_marks("my name", {7: "-|lower"})
        self.assertEqual(view.text, "my name -")
        self.assertIsNone(view.project(7, 9, "name"))
