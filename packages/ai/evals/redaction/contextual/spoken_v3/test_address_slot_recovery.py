import unittest

from address_slot_recovery import recover_address_slots


class AddressSlotRecoveryTests(unittest.TestCase):
    def recovered(self, text):
        return [text[hit.start:hit.end] for hit in recover_address_slots(text)]

    def test_misheard_number_and_street_suffix_at_delivery_cue(self):
        text = "leave the parcel at two tree six star peel lain then ring the bell"
        self.assertEqual(self.recovered(text), ["two tree six star peel lain"])

    def test_split_suffix_and_multiple_secondary_fields(self):
        text = "mail the paperwork to eight one oh wild fern a venue building bee unit nine and leave the slip"
        self.assertEqual(self.recovered(text), ["eight one oh wild fern a venue building bee unit nine"])

    def test_fallback_needs_a_private_cue_and_a_reliable_number(self):
        self.assertEqual(self.recovered("i live at three six one willow bay stir before the bridge"),
                         ["three six one willow bay stir"])
        self.assertEqual(self.recovered("we ended up outside three six one willow bay stir"), [])
        self.assertEqual(self.recovered("i live at for to ate willow bay stir"), [])

    def test_directions_time_and_receipt_numbers_are_preserved(self):
        for text in (
            "leave the package at eight forty five p m please",
            "the delivery form lists four one nine as the tracking number",
            "drop the parcel at two oh three mile marker on the highway",
            "the driver should follow gravel road past the hall",
            "we ended up outside gate three on the public walk",
        ):
            with self.subTest(text=text):
                self.assertEqual(self.recovered(text), [])
