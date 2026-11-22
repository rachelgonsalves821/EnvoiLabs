"""Complete a detected identity using nearby casing or an explicit role span."""

import re

from candidate import Hit


_WORD = re.compile(r"[^\W\d_]+(?:[’'-][^\W\d_]+)*")
_PERSON = {"name", "person"}
_ORGANIZATION = {"ORGANIZATION", "organization", "organization educational"}
_IDENTITY = _PERSON | _ORGANIZATION
_FUNCTION_WORDS = {
    "a", "an", "and", "at", "but", "by", "for", "from", "he", "i", "in", "it",
    "my", "now", "on", "or", "our", "she", "so", "the", "then", "there", "they",
    "to", "was", "we", "when", "where", "with", "you", "your",
}


def _can_join(view, left, right, neighbor):
    word = neighbor.group()
    return (
        view[left.end():right.start()].isspace()
        and word[0].isupper()
        and word.casefold() not in _FUNCTION_WORDS
    )


def _merge_adjacent_cased(view, hits):
    words = list(_WORD.finditer(view.text))
    spans = [view.project(word.start(), word.end(), "word") for word in words]
    for hit in hits:
        overlap = [index for index, span in enumerate(spans)
                   if span and span.start < hit.end and hit.start < span.end]
        if not overlap:
            continue
        first, last = overlap[0], overlap[-1]
        left, right = first, last
        if first and _can_join(view.text, words[first - 1], words[first], words[first - 1]):
            left -= 1
        if last + 1 < len(words) and _can_join(view.text, words[last], words[last + 1], words[last + 1]):
            right += 1
        if (left, right) == (first, last) or not spans[left] or not spans[right]:
            continue
        if right - left + 1 <= (4 if hit.label in _PERSON else 7):
            yield Hit(hit.label, min(spans[left].start, hit.start), max(spans[right].end, hit.end))


def complete_identity_boundaries(view, detections, explicit):
    identities = [hit for hit in detections if hit.label in _IDENTITY]
    yield from _merge_adjacent_cased(view, identities)
    for anchor in explicit:
        family = _PERSON if anchor.label == "person" else _ORGANIZATION
        if any(
            hit.label in family and anchor.start <= hit.start and hit.end <= anchor.end and hit.end - hit.start >= 4
            for hit in identities
        ):
            yield anchor
