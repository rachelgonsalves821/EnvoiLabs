import unittest

from asr_casing import restore_word_marks
from candidate import Hit
from identity_boundaries import complete_identity_boundaries


class IdentityBoundaryTests(unittest.TestCase):
    def test_adjacent_casing_completes_model_detection_on_original_offsets(self):
        view = restore_word_marks("meet ana rose here", {8: "0|Cap", 13: "0|Cap"})
        self.assertEqual(
            list(complete_identity_boundaries(view, [Hit("name", 9, 13)], [])),
            [Hit("name", 5, 13)],
        )

    def test_casing_expansion_respects_inserted_sentence_boundary(self):
        view = restore_word_marks("find ana rose", {8: ".|Cap", 13: "0|Cap"})
        self.assertEqual(list(complete_identity_boundaries(view, [Hit("name", 9, 13)], [])), [])

    def test_explicit_role_requires_an_enclosed_detection_of_the_same_family(self):
        view = restore_word_marks("i worked for west oak studio", {})
        employer = Hit("employer", 13, 28)
        people = [Hit("name", 18, 21)]
        organizations = [Hit("organization", 22, 28)]
        self.assertEqual(list(complete_identity_boundaries(view, people, [employer])), [])
        self.assertEqual(list(complete_identity_boundaries(view, organizations, [employer])), [employer])

    def test_contact_masks_and_uncorroborated_roles_are_untouched(self):
        view = restore_word_marks("my phone is ana rose", {15: "0|Cap", 20: "0|Cap"})
        self.assertEqual(
            list(complete_identity_boundaries(view, [Hit("phone", 16, 20)], [Hit("person", 12, 20)])), [],
        )
