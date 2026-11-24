import unittest

from spoken_contacts_recover import recovered_contacts


def masked_spans(text):
    return [(hit.label, text[hit.start:hit.end]) for hit in recovered_contacts(text)]


class SpokenContactRecoveryTests(unittest.TestCase):
    def test_complete_split_spoken_domain_with_structured_handle(self):
        for phrase in (
            "quartz dot cedar at copper leaf dot solutions",
            "lake.field at valley ridge dot technology",
            "fir underscore alder at orchard river dot net",
        ):
            with self.subTest(phrase=phrase):
                text = f"The recorded entry was {phrase}. The return policy was useful."
                emails = [text[hit.start:hit.end] for hit in recovered_contacts(text) if hit.label == "email"]
                self.assertIn(phrase, emails)

    def test_split_domain_does_not_substitute_for_email_shape(self):
        for text in (
            "I looked at Valley Ridge dot technology. Their checkout is useful.",
            "Look at pine dot guide at Copper Leaf dot solutions. That one is public.",
            "We buy from Cedar at the market dot net help desk.",
        ):
            with self.subTest(text=text):
                self.assertFalse(any(hit.label == "email" for hit in recovered_contacts(text)))

    def test_spelled_at_and_handle_separator_accept_unlisted_dns_suffix(self):
        for phrase in (
            "alder dot delta at copperworks dot technology",
            "quartz.cedar at pineport.solutions",
            "linden underscore book at marigold dot example",
        ):
            with self.subTest(phrase=phrase):
                text = "I wrote down the entry, " + phrase + ". The search page kept resetting."
                emails = [text[hit.start:hit.end] for hit in recovered_contacts(text) if hit.label == "email"]
                self.assertIn(phrase, emails)

    def test_unlisted_suffix_still_needs_complete_spelled_email_shape(self):
        for text in (
            "We shop at copperworks dot technology. Their menus load quickly.",
            "Look at pine dot guide at copperworks dot technology. The page shows the refund rules.",
            "The painted cedar dot border at north dot is a graphics label.",
            "I wrote down the entry, quartz at pineport dot solutions took a while.",
        ):
            with self.subTest(text=text):
                self.assertFalse(any(hit.label == "email" for hit in recovered_contacts(text)))

    def test_unlisted_mailbox_can_end_at_adjacent_phone(self):
        email = "alder dot rill at copperworks dot solutions"
        text = f"They transcribed {email} and +1 202-555-0146 for processing."
        emails = [text[hit.start:hit.end] for hit in recovered_contacts(text) if hit.label == "email"]
        self.assertEqual(emails, [email])

    def test_adjacent_phone_does_not_steal_website_or_intervening_prose(self):
        for text in (
            "Look at alder dot rill at copperworks dot solutions and +1 202-555-0146 for processing.",
            "They sell at copperworks dot solutions and refunded the order so I called +1 202-555-0146.",
            "I wrote the phrase at copperworks dot rapidly erased wording before I dialed +1 202-555-0146.",
        ):
            with self.subTest(text=text):
                self.assertFalse(any(hit.label == "email" for hit in recovered_contacts(text)))

    def test_international_phone_with_spoken_country_code(self):
        number = "plus four four seven seven zero zero nine zero zero one two three"
        self.assertEqual(masked_spans(f"call me at {number} after four"), [("phone", number)])

    def test_spoken_repetition_and_following_description(self):
        number = "four one six triple five zero double two five"
        self.assertEqual(masked_spans(f"my phone is {number} for calls"), [("phone", number)])

    def test_fused_domain_separator_and_spoken_at_sign(self):
        address = "cloud plus fern at sign mailbox dotcom"
        self.assertEqual(masked_spans(f"my inbox is {address} today"), [("email", address)])

    def test_dictated_handle_after_a_punctuated_introduction(self):
        address = "river a b two at mailbox dot invalid"
        self.assertEqual(masked_spans(f"I'll say the email slowly: {address}."), [("email", address)])

    def test_letter_and_number_suffix_after_a_lightweight_cue(self):
        address = "cloud b five at mailbox dot org"
        self.assertEqual(masked_spans(f"I check {address} at lunch."), [("email", address)])
        self.assertEqual(masked_spans("Try the new dishes at mailbox dot org."), [])

    def test_missing_at_requires_handle_or_direct_contact_structure(self):
        address = "fern plus jay mailbox dot dev"
        self.assertEqual(masked_spans(f"my email is {address} now"), [("email", address)])
        self.assertEqual(masked_spans("the cafe listed river dot com"), [])

    def test_order_identifiers_do_not_match_partial_or_complete_phone_formats(self):
        for number in ("one two three four five six seven eight", "one two three four five six seven eight nine zero"):
            with self.subTest(number=number):
                self.assertEqual(masked_spans(f"my order number {number} was wrong"), [])

    def test_explicit_phone_cue_takes_precedence_over_an_earlier_order_reference(self):
        number = "four one six triple five zero double two five"
        text = f"For that order number, call me at {number} tomorrow"
        self.assertEqual(masked_spans(text), [("phone", number)])

    def test_website_navigation_is_not_an_address(self):
        self.assertEqual(masked_spans("the email survey told me to look at garden dot com"), [])


if __name__ == "__main__":
    unittest.main()
