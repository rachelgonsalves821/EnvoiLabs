"""Full-input verification boundaries shared by the local detectors."""

import re


class RedactionInputTooLong(ValueError):
    """The detector could not process the entire input in one call."""


_WORD = re.compile(r"\S+")
_WINDOW_WORDS = 128
_OVERLAP_WORDS = 64


def answer_windows(text):
    """Keep overlap larger than the bounded identity and contact cue windows."""
    words = list(_WORD.finditer(text))
    for first in range(0, len(words), _WINDOW_WORDS - _OVERLAP_WORDS):
        last = first + _WINDOW_WORDS
        start = words[first].start() if first else 0
        if last >= len(words):
            yield start, len(text)
            return
        yield start, words[last].start()
