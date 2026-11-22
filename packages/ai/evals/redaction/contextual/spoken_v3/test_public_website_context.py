import unittest

from candidate import Hit
from public_website_context import preserving_public_ref, public_website_ranges


def hit_for(text, segment, label="organization"):
    start = text.index(segment)
    return Hit(label, start, start + len(segment))


def preserves(text, segment, label="organization", identities=()):
    return preserving_public_ref(text, hit_for(text, segment, label), identities, tuple(public_website_ranges(text)))


class PublicWebsiteContextTests(unittest.TestCase):
    def test_explicit_spoken_site_keeps_its_original_scope(self):
        text = "the catalog site is paperwillow dot co m and it showed three photos"
        self.assertEqual(
            [text[start:end] for start, end in public_website_ranges(text)],
            ["paperwillow dot co m"],
        )
        self.assertTrue(preserves(text, "paperwillow"))
        self.assertFalse(preserves(text, "and it showed three photos"))

    def test_action_verb_in_site_detection_does_not_expand_the_mask(self):
        text = "for the public website enter autumn leaf dot net"
        self.assertFalse(preserves(text, "enter autumn leaf", label="name"))
        text = "for the public website enter autumnleaf dot net"
        self.assertTrue(preserves(text, "enter autumnleaf", label="name"))

    def test_personal_employer_website_keeps_contextual_identity_mask(self):
        text = "my employer's website is velvet orchard dot net"
        self.assertFalse(preserves(text, "orchard"))

    def test_email_and_explicit_identity_masks_are_ineligible(self):
        text = "the website uses emmy@paperwillow.test"
        self.assertFalse(preserves(text, "emmy@paperwillow.test", label="email"))
        text = "the product variant is ruby moon"
        annotated = hit_for(text, "ruby moon", label="person")
        self.assertFalse(preserves(text, "ruby moon", label="person", identities=[annotated]))

    def test_product_variant_after_a_clear_label_stays_available(self):
        text = "the product variant is ruby moon and it disappeared"
        self.assertTrue(preserves(text, "ruby moon", label="person"))
