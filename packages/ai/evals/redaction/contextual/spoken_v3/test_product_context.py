import unittest

from candidate import Hit
from product_context import (
    is_explicit_commercial_reference, is_product_title, is_public_organization_reference, public_organization_ranges,
)
from speech_context import Restored
from spoken_pipeline import redact


class ProductContextTests(unittest.TestCase):
    def detection(self, text, span, label="organization"):
        start = text.index(span)
        return Hit(label, start, start + len(span))

    def test_menu_and_shop_labels(self):
        for text, title in (
            ("the menu label was blue bowl so i picked it", "blue bowl"),
            ("the shop was called yellow kettle and i found it", "yellow kettle"),
            ("we chose river garden from the menu", "river garden"),
        ):
            with self.subTest(text=text):
                self.assertTrue(is_product_title(text, self.detection(text, title), ()))

    def test_employer_cue_protects_mask_from_product_filter(self):
        text = "i work at a restaurant called river garden from the menu list"
        self.assertFalse(is_product_title(text, self.detection(text, "river garden"), ()))

    def test_explicit_identity_span_takes_priority_over_product_cue(self):
        text = "the menu label was Gray Orchard"
        flagged = self.detection(text, "Gray Orchard")
        self.assertFalse(is_product_title(text, flagged, (flagged,)))

    def test_contact_masks_do_not_depend_on_product_context(self):
        text = "the menu displayed myemail@sample.test"
        hit = self.detection(text, "myemail@sample.test", label="email address")
        self.assertFalse(is_product_title(text, hit, ()))

    def test_explicit_labels_preserve_research_terms(self):
        for text, value in (
            ("it was filed under violet mint which is the product name", "violet mint"),
            ("the form lists violet mint as a public supplier", "violet mint"),
            ("the tutorial uses violet mint as the sample workplace", "violet mint"),
            ("the shop was quieter after lunch", "shop"),
            ("we considered it and the menu label was roasted plum plate", "plum plate"),
            ("the app called it the garden platter then I paid", "platter"),
            ("our school of thought was to order ahead", "school of thought"),
        ):
            with self.subTest(text=text):
                self.assertTrue(is_explicit_commercial_reference(text, self.detection(text, value), ()))

    def test_private_and_unclassified_values_remain_masked(self):
        for text, value in (
            ("violet mint is my name on the order", "violet mint"),
            ("my employer is violet mint as a public supplier", "violet mint"),
            ("the form lists violet mint as the sample workplace", "violet mint"),
            ("i started working at Shop", "Shop"),
            ("the app called it in error after I entered my name, violet mint", "violet mint"),
            ("my employer is School of Thought and I work there", "School of Thought"),
        ):
            with self.subTest(text=text):
                self.assertFalse(is_explicit_commercial_reference(text, self.detection(text, value), ()))

    def test_corroborated_hits_override_a_commercial_label(self):
        text = "the form lists violet mint as a public supplier"
        commercial = self.detection(text, "violet mint")
        private = self.detection(text, "violet", "person")
        self.assertFalse(is_explicit_commercial_reference(text, commercial, (private,)))

    def test_receipt_merchant_range_preserves_exact_source_organization_only(self):
        value = "Laurène Vale Equipment Ltd."
        text = f"🧾 The checkout receipt names {value} as the vendor. The quantity was clear."
        ranges = tuple(public_organization_ranges(text))
        seller = self.detection(text, value, "ORGANIZATION")
        self.assertEqual(ranges, ((seller.start, seller.end),))
        self.assertTrue(is_public_organization_reference(seller, ranges, ()))
        self.assertTrue(is_public_organization_reference(self.detection(text, "Vale Equipment", "organization"),
                                                         ranges, ()))
        for label in ("person", "name", "employer", "phone number", "address"):
            with self.subTest(label=label):
                self.assertFalse(is_public_organization_reference(self.detection(text, value, label), ranges, ()))
        self.assertFalse(is_public_organization_reference(self.detection(text, value + " as the vendor"), ranges, ()))
        self.assertFalse(is_public_organization_reference(seller, ranges, (self.detection(text, "Laurène", "person"),)))

    def test_similar_receipt_fields_do_not_override_private_roles(self):
        for text in (
            "The receipt names my employer Dovewake Lantern Works Inc. as the merchant.",
            "The receipt lists Cinder Brae Supply LLC as the seller and I work there.",
            "I work there and the receipt lists Cinder Brae Supply LLC as the seller.",
            "The receipt lists Cinder Brae Supply LLC as the seller, the company where I work.",
            "The receipt lists Cinder Brae Supply LLC as the seller. I work there.",
            "The receipt lists Cinder Brae Supply LLC as the seller. That's my company.",
            "The receipt lists Cinder Brae Supply LLC as the seller. I'm on their payroll.",
            "The receipt shows Cinder Brae Supply LLC as the vendor representative.",
            "The receipt shows Cinder Brae Supply LLC as the vendor contact.",
            "The receipt names Cinder Brae Supply LLC as the seller address.",
            "The receipt lists Berit Lorne as the seller.",
            "The receipt lists 18 Brindle Quay Street as the vendor.",
            "The receipt lists 212-555-0149 as the merchant.",
        ):
            with self.subTest(text=text):
                self.assertEqual(tuple(public_organization_ranges(text)), ())

    def test_receipt_seller_preservation_flows_through_both_recognizers(self):
        company = "Cinder Brae Supply LLC"
        text = f"The order receipt names {company} as the seller. My legal name is Berit Lorne."
        deterministic = lambda source: (self.detection(source, company, "ORGANIZATION"),)
        contextual = lambda source, _: (self.detection(source, "cinder brae" if source.islower() else "Cinder Brae"),)
        restore = lambda source: Restored(source, tuple(range(len(source))))
        self.assertEqual(
            redact(text, deterministic, contextual, restore),
            f"The order receipt names {company} as the seller. My legal name is [redacted].",
        )
