import unittest

from email_slot_recovery import recover_corroborated_mailboxes, recover_email_slots


def spans(text):
    return [text[hit.start:hit.end] for hit in recover_email_slots(text)]


class EmailSlotRecoveryTests(unittest.TestCase):
    def test_misheard_dot_after_a_direct_email_label(self):
        address = "winter dot oak at mailbox daught test"
        self.assertEqual(spans(f"my email is {address} and the gate was locked"), [address])

    def test_split_and_dictated_suffixes_keep_original_text(self):
        for suffix in ("te st", "t e s t"):
            address = f"cloud two at mailbox dot {suffix}"
            with self.subTest(suffix=suffix):
                self.assertEqual(spans(f"write to {address} and leave the survey open"), [address])

    def test_fused_host_needs_explicit_email_context(self):
        address = "beech at mailboxcom"
        self.assertEqual(spans(f"email me at {address} then open the help panel"), [address])
        self.assertEqual(spans("i looked at mailboxcom then opened the help panel"), [])

    def test_missing_separator_can_stay_inside_a_labeled_address(self):
        address = "shelf two mailbox dot test"
        self.assertEqual(spans(f"my email address is {address} and the food was cold"), [address])

    def test_misheard_at_still_requires_an_address_shape(self):
        address = "one underscore place and mailbox dot test"
        self.assertEqual(spans(f"my inbox is {address} before noon"), [address])

    def test_public_website_visit_and_product_label_remain_available(self):
        self.assertEqual(spans("try the new dishes at market dot com"), [])
        self.assertEqual(spans("i used the menu at market dot com and the type was small"), [])


class CorroboratedMailboxTests(unittest.TestCase):
    def recovered(self, text):
        return {text[hit.start:hit.end] for hit in recover_corroborated_mailboxes(text)}

    def test_explicit_mailbox_supports_split_host_and_two_word_marker(self):
        address = "ember five as an violet creek dot test"
        self.assertIn(address, self.recovered(f"my inbox is {address} before the deadline"))

    def test_phone_and_follow_up_wording_support_corrupted_separator(self):
        address = "windmill pears at violet creek drug test"
        text = f"you can call one six zero four five five five zero one zero zero try {address} before noon"
        self.assertIn(address, self.recovered(text))
        self.assertEqual(self.recovered(f"try {address} before noon"), set())

    def test_fused_separator_and_suffix(self):
        address = "winter brick at mailbox dotcom"
        self.assertIn(address, self.recovered(f"my inbox is {address} before noon"))

    def test_verified_mailbox_keeps_unpunctuated_feedback_after_fused_host(self):
        address = "winter brick at meadowtest"
        text = f"the email we verified is {address} the chair near the counter was handy"
        self.assertEqual(self.recovered(text), {address})

    def test_split_suffix_stops_before_feedback(self):
        address = "ember flight at violet creek dott te st"
        text = f"in my email field please enter {address} the menu price was easy to find"
        self.assertIn(address, self.recovered(text))

    def test_explicit_website_language_preserves_research(self):
        self.assertEqual(self.recovered("my inbox is open and i used the public site at market dot com"), set())
        text = "call one six zero four five five five zero one zero zero try our product label at market dot com"
        self.assertEqual(self.recovered(text), set())
