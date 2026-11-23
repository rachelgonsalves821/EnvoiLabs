import unittest

from candidate import Hit, mask
from speech_context import Restored
from spoken_pipeline import CANDIDATE, redact, render_redacted, span_variants


def no_detections(*_):
    return ()


def restore(text):
    return Restored(text, tuple(range(len(text))))


class SpokenPipelineTests(unittest.TestCase):
    def test_readable_result_and_evaluator_share_the_address_spans(self):
        text = "Please leave the parcel at two tree six Star Peel lain then ring the bell"
        reports = dict(span_variants(text, no_detections, no_detections, restore))
        masked = mask(text, reports[CANDIDATE])
        address = "two tree six Star Peel lain"
        self.assertEqual(masked, text.replace(address, "\uE000" * len(address)))
        self.assertEqual(redact(text, no_detections, no_detections, restore), text.replace(address, "[redacted]"))

    def test_readable_renderer_combines_overlapping_and_adjacent_detections(self):
        spans = (Hit("name", 5, 8), Hit("address", 8, 10), Hit("name", 2, 7), Hit("name", 12, 14))
        self.assertEqual(render_redacted("abcdefghijklmnop", spans), "ab[redacted]kl[redacted]op")

    def test_invalid_span_and_non_reversible_casing_fail_closed(self):
        with self.assertRaises(ValueError):
            render_redacted("abc", (Hit("person", 1, 4),))
        with self.assertRaises(ValueError):
            redact("İstanbul", no_detections, no_detections, restore)
        with self.assertRaises(ValueError):
            redact("text", no_detections, no_detections, None)
