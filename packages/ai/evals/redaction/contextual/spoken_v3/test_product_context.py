import unittest

from candidate import Hit
from product_context import is_explicit_commercial_reference, is_product_title


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
