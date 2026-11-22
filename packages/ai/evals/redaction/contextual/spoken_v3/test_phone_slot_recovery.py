import unittest

from phone_slot_recovery import recover_number_slots


def contact_spans(text):
    return [text[span.start:span.end] for span in recover_number_slots(text)]


class PhoneSlotRecoveryTests(unittest.TestCase):
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
