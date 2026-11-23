import unittest

from asr_casing import restore_word_marks
from candidate import Hit
from person_slot_recovery import detect_person_slots


def slot_hits(text, case_word=None, detections=()):
    labels = {} if case_word is None else {text.index(case_word) + len(case_word): "0|Cap"}
    return list(detect_person_slots(text, restore_word_marks(text, labels), detections))


def name(text, source):
    start = text.index(source)
    return Hit("person", start, start + len(source))


class PersonSlotTests(unittest.TestCase):
    def test_record_slot_keeps_split_words_and_stops_at_next_clause(self):
        text = "they wrote down alina elder week when i arrived before opening"
        self.assertEqual(slot_hits(text, "alina"), [name(text, "alina elder week")])

    def test_record_slot_can_be_corroborated_by_existing_person_span(self):
        text = "the roster lists adel copper lane before it shows the arrival time"
        self.assertEqual(slot_hits(text, detections=[name(text, "adel")]), [name(text, "adel copper lane")])

    def test_explicit_signature_preserves_the_label_as_original_words(self):
        text = "i signed the forms under ana taylor before they checked the receipt"
        self.assertEqual(slot_hits(text, "ana"), [name(text, "ana taylor")])

    def test_opinion_with_no_person_signal_remains_available(self):
        text = "i'm somewhat disappointed by the way"
        self.assertEqual(slot_hits(text), [])

    def test_telephone_frequency_without_a_name_signal_is_ignored(self):
        self.assertEqual(slot_hits("they call me pretty often"), [])

    def test_product_and_order_labels_do_not_count_as_person_slots(self):
        self.assertEqual(slot_hits("the receipt uses discount code blue sky", "blue"), [])

    def test_sentence_case_preserves_signing_and_record_boundaries(self):
        for text, private in (
            ("I signed the forms under Merin Fielding Before they checked the receipt.", "Merin Fielding"),
            ("The roster lists Dariel Birch Lane And I received the reminder.", "Dariel Birch Lane"),
            ("I go by Corin Dove And I wanted the early pickup.", "Corin Dove"),
            ("People call me Eril Daily Before they check the roster.", "Eril Daily"),
        ):
            with self.subTest(text=text):
                self.assertEqual(slot_hits(text), [name(text, private)])

    def test_cased_introduction_still_needs_corroboration(self):
        text = "I’m berin rémy By The Way."
        person = name(text, "berin rémy")
        self.assertEqual(slot_hits(text), [])
        self.assertEqual(slot_hits(text, "berin"), [person])
        self.assertEqual(slot_hits(text, detections=[name(text, "berin")]), [person])
        self.assertEqual(slot_hits("I'm Berin Rémy."), [])

    def test_capitalized_ordinary_speech_and_roles_are_preserved(self):
        for text in (
            "I'm A Floor Supervisor By The Way.",
            "I'm Floor Supervisor By The Way.",
            "I'm Very Disappointed By The Way.",
            "I'm Somewhat Disappointed By The Way.",
            "The receipt uses Discount Code Silver Morning.",
            "They call me Pretty Often.",
            "I go by Bus Most Days.",
            "I go by word of mouth.",
        ):
            with self.subTest(text=text):
                self.assertEqual(slot_hits(text), [])
