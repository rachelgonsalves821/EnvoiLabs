import unittest

from email_slot_recovery import recover_email_slots


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
