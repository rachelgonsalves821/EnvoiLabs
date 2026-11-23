import unittest

from confirmed_names import confirmed_name_slots


def spans(text):
    return [text[hit.start:hit.end] for hit in confirmed_name_slots(text)]


class ConfirmedNameTests(unittest.TestCase):
    def test_record_and_confirmation_keep_fragmented_name_at_source_offsets(self):
        text = "they put it under kay copper vales which is my full name"
        self.assertEqual(spans(text), ["kay copper vales"])

    def test_direct_name_label_stops_before_an_employer_value(self):
        text = "my legal name is: elle doe my employer is maple research"
        self.assertEqual(spans(text), ["elle doe"])

    def test_preferred_name_uses_the_adjacent_employer_as_a_boundary(self):
        text = "i don't go by the shortened name now use mina harbor lynn my employer is maple research"
        self.assertEqual(spans(text), ["mina harbor lynn"])

    def test_explicit_badge_field_and_pickup_contact_support_person_names(self):
        self.assertEqual(spans("i used my badge name, fia oak rose on the card"), ["fia oak rose"])
        self.assertEqual(spans("the pickup contact is pippa redleaf an employee of fall lab"), ["pippa redleaf"])

    def test_roster_name_is_bounded_by_the_second_private_field(self):
        text = "the attendance list says ellis cold run and that my workplace is cedar lab"
        self.assertEqual(spans(text), ["ellis cold run"])

    def test_product_label_and_unconfirmed_booking_code_remain_available(self):
        self.assertEqual(spans("they put it under cooked apple bowl which is the product name"), [])
        self.assertEqual(spans("i booked the pickup under order number four three after lunch"), [])
