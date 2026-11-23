import unittest

from address_slot_recovery import recover_address_slots, recover_corroborated_addresses


class AddressSlotRecoveryTests(unittest.TestCase):
    def corroborated(self, text):
        return [text[hit.start:hit.end] for hit in recover_corroborated_addresses(text)]

    def test_residence_and_appointment_recover_collapsed_street_suffix(self):
        self.assertEqual(self.corroborated("i stayed at to seven silver grove terrorists before i moved"),
                         ["to seven silver grove terrorists"])
        self.assertEqual(self.corroborated("the reception clerk made me at three zero maple spur elaine"),
                         ["three zero maple spur elaine"])
        self.assertEqual(self.corroborated("i made me at three zero maple spur elaine"), [])

    def test_linked_landmark_needs_a_house_number_and_whole_bounded_destination(self):
        value = "five eight three silver path years"
        self.assertEqual(self.corroborated(f"we started the walk near the school and ended up at {value}"), [value])
        self.assertEqual(self.corroborated(f"we ended up at {value}"), [])
        self.assertEqual(self.corroborated("we started the walk near the school and ended up at five eight three public gate"), [])

    def test_single_spoken_house_number_requires_a_private_role_and_street_type(self):
        self.assertEqual(self.corroborated("my place is at four quartz leaf curt then tap the button"),
                         ["four quartz leaf curt"])
        self.assertEqual(self.corroborated("pick me up at four quartz leaf weigh and leave the bag"),
                         ["four quartz leaf weigh"])
        self.assertEqual(self.corroborated("pick me up at four quartz leaf marker and leave the bag"), [])

    def test_turn_instruction_needs_a_matching_delivery_clause(self):
        value = "six salt nettle dry"
        self.assertEqual(self.corroborated(f"turn in at {value} where i asked them to leave the parcel"), [value])
        self.assertEqual(self.corroborated(f"turn in at {value} cleaners because the leaflet was there"), [])
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
