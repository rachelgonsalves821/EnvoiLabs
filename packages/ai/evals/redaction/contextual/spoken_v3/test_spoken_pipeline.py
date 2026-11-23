import unittest

from candidate import Hit, mask
from redaction_input import RedactionInputTooLong, answer_windows
from speech_context import Restored
from spoken_pipeline import CANDIDATE, redact, redaction_spans, render_redacted, span_variants


def no_detections(*_):
    return ()


def restore(text):
    return Restored(text, tuple(range(len(text))))


def bounded_restore(text):
    if len(text.split()) > 128:
        raise RedactionInputTooLong("Test model input limit")
    return restore(text)


class SpokenPipelineTests(unittest.TestCase):
    def test_spoken_public_locator_preserves_evidence_across_all_detectors(self):
        locator = "public menu at hazelwheel dot test"
        text = "I checked the " + locator + " before comparing options."

        def detected(source):
            start = source.index(locator)
            return (Hit("EMAIL_ADDRESS", start + len("public "), start + len(locator)),)

        self.assertEqual(redact(text, detected, no_detections, restore), text)
        private = "My e-mail address is " + locator + ". The filter was clear."
        rendered = redact(private, detected, no_detections, restore)
        self.assertIn("[redacted]", rendered)
        self.assertNotIn("hazelwheel", rendered)
        self.assertIn("The filter was clear.", rendered)

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

    def test_long_answer_windows_cover_the_full_source_with_overlap(self):
        text = " \n" + "word " * 520 + "tail\t"
        windows = list(answer_windows(text))
        self.assertEqual(windows[0][0], 0)
        self.assertEqual(windows[-1][1], len(text))
        for left, right in zip(windows, windows[1:]):
            self.assertLess(right[0], left[1])
            self.assertEqual(len(text[right[0]:left[1]].split()), 64)

    def test_masks_identity_across_split_and_address_at_the_end(self):
        text = (
            "word " * 123 + "my full name is Vera Finch and the button was hard to find. "
            + "word " * 360 + "please leave the parcel at two tree six Star Peel lain then ring the bell"
        )
        _, first_end = next(answer_windows(text))
        self.assertEqual(text[:first_end].split()[-1], "Vera")
        spans = redaction_spans(text, no_detections, no_detections, bounded_restore)
        self.assertIn("Vera Finch", {text[hit.start:hit.end] for hit in spans})
        rendered = redact(text, no_detections, no_detections, bounded_restore)
        self.assertNotIn("Vera Finch", rendered)
        self.assertNotIn("Star Peel", rendered)
        self.assertIn("the button was hard to find", rendered)

    def test_late_error_withholds_the_whole_answer(self):
        def restore_until_error(text):
            result = bounded_restore(text)
            if "lateerror" in text:
                raise ValueError("Detector output failed verification")
            return result

        text = "my full name is Vera Finch and the button was hard to find. " + "word " * 380 + "lateerror"
        with self.assertRaisesRegex(ValueError, "failed verification"):
            redact(text, no_detections, no_detections, restore_until_error)
