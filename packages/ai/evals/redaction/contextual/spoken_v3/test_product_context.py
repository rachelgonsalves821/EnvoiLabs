import unittest

from candidate import Hit
from product_context import is_product_title


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
