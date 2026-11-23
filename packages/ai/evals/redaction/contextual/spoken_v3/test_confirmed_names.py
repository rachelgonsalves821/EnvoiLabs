import unittest

from candidate import Hit
from confirmed_names import confirmed_name_slots, record_name_slots


def spans(text):
    return [text[hit.start:hit.end] for hit in confirmed_name_slots(text)]


class ConfirmedNameTests(unittest.TestCase):
    def test_damaged_badge_word_is_bounded_by_a_personal_card_field(self):
        value = "Mira row vell"
        text = f"they wrote my bad name {value} on the card and i used the first counter"
        spans = [text[hit.start:hit.end] for hit in record_name_slots(text, ())]
        self.assertEqual(spans, [value])
        self.assertEqual(list(record_name_slots("they displayed the product name fern kettle on the card", ())), [])

    def test_generic_receipt_value_requires_a_contained_person_detection(self):
        value = "there a May Finch"
        text = f"the order recede uses {value} and the screen had a timer"
        start = text.index("May Finch")
        detection = Hit("name", start, start + len("May Finch"))
        self.assertEqual(list(record_name_slots(text, ())), [])
        spans = [text[hit.start:hit.end] for hit in record_name_slots(text, (detection,))]
        self.assertEqual(spans, [value])

    def test_explicit_recipient_and_public_business_contexts(self):
        value = "drew new deck"
        text = f"the pickup collector is {value} and i could see the second door"
        spans = [text[hit.start:hit.end] for hit in record_name_slots(text, ())]
        self.assertEqual(spans, [value])
        business = "the order receipt lists blue cinder as the vendor and i checked the label"
        start = business.index("blue cinder")
        hit = Hit("person", start, start + len("blue cinder"))
        self.assertEqual(list(record_name_slots(business, (hit,))), [])
        self.assertEqual(list(record_name_slots("they wrote down four early shift tasks", ())), [])

    def test_person_confirmation_distinguishes_name_from_shift_label(self):
        value = "Lena Orm Pell"
        text = f"the badge clipped to my lanyard says {value} thats the name the crew uses"
        spans = [text[hit.start:hit.end] for hit in record_name_slots(text, ())]
        self.assertEqual(spans, [value])
        label = "the badge clipped to my lanyard says early crew thats the shift label the badge was loose"
        self.assertEqual(list(record_name_slots(label, ())), [])

    def test_signature_needs_an_explicit_name_field(self):
        value = "a lee brown"
        text = f"i signed in with my name {value} and they printed the receipt"
        spans = [text[hit.start:hit.end] for hit in record_name_slots(text, ())]
        self.assertEqual(spans, [value])
        self.assertEqual(list(record_name_slots("i signed the form for Saturday Meal and liked the stock", ())), [])
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
