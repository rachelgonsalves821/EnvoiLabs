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

    def test_private_residence_keeps_qualified_flat_and_its_number(self):
        value = "three Dovetail Vale crescent rear flat number eight"
        self.assertEqual(self.corroborated(f"The repair crew should go to my home, {value}, and call in advance."),
                         [value])
        self.assertEqual(self.corroborated("The repair crew should go to Dovetail Vale crescent rear public steps."), [])

    def test_private_doorstep_can_recover_split_street_type_and_access(self):
        value = "eight Sedge Elm boul uh vard bungalow C side entrance"
        self.assertEqual(self.corroborated(f"My doorstep is {value}. The slot changed twice."), [value])
        self.assertEqual(self.corroborated("Walk along Sedge Elm boulevard to the side entrance at eight thirty."), [])
        self.assertEqual(self.corroborated("My doorstep is at eight thirty by the public gate."), [])

    def test_transaction_delivery_address_requires_an_explicit_label_and_street_type(self):
        value = "34 Heath Rill Road block bee"
        text = f"The delivery address is {value} and the doorbell was useful."
        self.assertEqual(self.recovered(text), [value])
        self.assertEqual(self.corroborated(text), [value])
        for public in (
            "The store's advertised delivery address is 34 Heath Rill Road.",
            "The delivery address for the public depot is 34 Heath Rill Road.",
            "The delivery address is 34 Heath Rill Road, which is the public pickup counter.",
            "The delivery address is 34 at the public pickup counter.",
            "The delivery address is two three four queue line marker.",
        ):
            with self.subTest(text=public):
                self.assertEqual(self.recovered(public), [])
                self.assertEqual(self.corroborated(public), [])

    def test_written_unit_punctuation_preserves_original_offsets(self):
        for value in (
            "22 Orchid Knoll Rd., Apt. 6",
            "22 Orchid Knoll Rd. Apt. 6B",
            "22 Orchid Knoll Road, Apt. 6",
            "15 Nettle Ash Ave., Unit C",
        ):
            text = f"I live at {value}. The filter showed two choices."
            with self.subTest(text=text):
                self.assertEqual(self.recovered(text), [value])
                self.assertEqual(self.corroborated(text), [value])
        value = "15 Nettle Ash Ave., Apt. 6"
        self.assertEqual(self.corroborated(f"My doorstep is {value}. The filter showed two choices."), [value])

    def test_written_unit_does_not_cross_a_sentence_or_mask_pickup_evidence(self):
        for text, value in (
            ("I live at 23 Amber Firth Road. Unit 6 was the model I tried.", "23 Amber Firth Road"),
            ("I live at 23 Amber Firth Rd. Pickup code 152 was easy to see.", "23 Amber Firth Rd"),
            ("I live at 23 Amber Firth Rd., Apt. pricing changed overnight.", "23 Amber Firth Rd"),
            ("I live at 23 Amber Firth Rd., Apt. 34567 was the order ID.", "23 Amber Firth Rd"),
        ):
            with self.subTest(text=text):
                self.assertEqual(self.recovered(text), [value])
                self.assertEqual(self.corroborated(text), [value])

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
