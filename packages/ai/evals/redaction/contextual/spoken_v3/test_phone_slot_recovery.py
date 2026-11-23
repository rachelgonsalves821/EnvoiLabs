import unittest

from candidate import Hit
from phone_slot_recovery import recover_corroborated_numbers, recover_number_slots


def contact_spans(text):
    return [text[span.start:span.end] for span in recover_number_slots(text)]


class PhoneSlotRecoveryTests(unittest.TestCase):
    def test_literal_international_callback_masks_prefix_and_stops_before_pickup_code(self):
        for number in ("0044 7700 900272", "00 44 (0) 7700 900272", "00447700900272"):
            with self.subTest(number=number):
                text = f"The courier left early. Call me at {number} then keep the pickup code 0044 visible."
                start = text.index(number)
                self.assertEqual(list(recover_corroborated_numbers(text, ())), [
                    Hit("phone", start, start + len(number)),
                ])

    def test_literal_international_form_requires_a_phone_label_and_valid_country_and_length(self):
        for text in (
            "The tracking number is 0044 7700 900272 and the label was easy to read.",
            "The order number is 00447700900272 and the door was locked.",
            "I used 0044 7700 900272 for the printed receipt.",
            "Call me at 0099 900 900272 and keep the pickup instructions visible.",
            "Call me at 0044 7700 900272 42 and keep both numbers visible.",
        ):
            with self.subTest(text=text):
                self.assertEqual(list(recover_corroborated_numbers(text, ())), [])

    def test_spoken_tail_needs_a_complete_corroborated_phone(self):
        number = "one eight zero eight five five five zero one two eve"
        text = f"my contact number is {number} and the receipt was legible"
        self.assertEqual([text[hit.start:hit.end] for hit in recover_corroborated_numbers(text, ())], [number])
        text = f"my order number is {number} and the receipt was legible"
        self.assertEqual(list(recover_corroborated_numbers(text, ())), [])

    def test_area_code_number_keeps_spoken_final_homophone(self):
        number = "zero double seven double zero nine double zero double one to"
        text = f"the number with the new area code is {number} the survey stayed open"
        self.assertEqual([text[hit.start:hit.end] for hit in recover_corroborated_numbers(text, ())], [number])

    def test_generic_follow_up_needs_a_corroborating_mailbox(self):
        number = "zero double seven double zero nine double zero four two six"
        address = "winter@example.test"
        text = f"for the follow up at {number} and then {address} for the receipt"
        self.assertEqual(list(recover_corroborated_numbers(text, ())), [])
        start = text.index(address)
        hit = Hit("email", start, start + len(address))
        self.assertEqual([text[item.start:item.end] for item in recover_corroborated_numbers(text, (hit,))], [number])

    def test_labels_keep_noisy_starts_and_local_values(self):
        for label, number in (
            ("call my cell at", "free seven nine five five five zero one nine zero"),
            ("dial my local phone", "double five five zero one nine three"),
        ):
            with self.subTest(label=label):
                text = f"{label} {number} the signup form was easy to read"
                self.assertEqual([text[hit.start:hit.end] for hit in recover_corroborated_numbers(text, ())], [number])

    def test_spoken_alternate_must_be_a_digit_in_the_contact_clause(self):
        stem = "four nine eight five five five zero one double six"
        phone = f"{stem} or sicks"
        text = f"please text my number at {phone} and leave the label visible"
        self.assertEqual([text[hit.start:hit.end] for hit in recover_corroborated_numbers(text, ())], [phone])
        text = f"please text my number at {stem} or send six labels"
        self.assertEqual([text[hit.start:hit.end] for hit in recover_corroborated_numbers(text, ())], [stem])
    def test_phone_cue_allows_an_internal_speech_gap(self):
        number = "two one three five five um five zero one three six"
        self.assertEqual(contact_spans(f"call me on {number} because the door was locked"), [number])

    def test_two_possible_final_digits_stay_in_one_mask(self):
        number = "four one six five five five zero one five two or three"
        self.assertEqual(contact_spans(f"my callback number is {number} and the driver waited"), [number])

    def test_callback_mask_ends_before_an_unrelated_pickup_code(self):
        number = "four one six five five five zero one five two"
        text = f"call me back at {number} then the pickup code is two nine three"
        self.assertEqual(contact_spans(text), [number])

    def test_ambiguous_leading_four_needs_written_numeric_support(self):
        number = "for one six five five five zero one five two"
        self.assertEqual(contact_spans(f"the screen shows {number} because i updated it"), [number])
        self.assertEqual(contact_spans(f"the stock code shows {number} because i updated it"), [])

    def test_order_number_and_quantity_remain_available(self):
        text = "the order number is five one two five five five zero one two four"
        self.assertEqual(contact_spans(text), [])
        self.assertEqual(contact_spans("i use four boxes and normally order three more"), [])

    def test_phone_cue_can_separate_phone_from_an_earlier_reference_label(self):
        number = "six one three five five err five zero one seven six"
        self.assertEqual(contact_spans(f"about the order number call me back at {number}"), [number])
