"""Evaluate source-coordinate person slots that tolerate split words."""

import re

from candidate import Hit


_WORD = re.compile(r"[^\W\d_]+(?:['’\-][^\W\d_]+)*")
_PERSON = {"name", "person"}
_SLOT = (
    ("direct", re.compile(
        r"\b(?:i go by|"
        r"the name (?:on|in) (?:the|my) (?:receipt|forms?|badge|roster) (?:is|was)|"
        r"i signed (?:the |my )?(?:forms?|register|card) (?:as|under))\s+"
    )),
    ("nickname", re.compile(r"\b(?:they|people|friends|family) call me\s+")),
    ("introduction", re.compile(r"\bi(?:'m|’m| am)\s+")),
    ("record", re.compile(
        r"\b(?:(?:they|the organizer|the clerk) (?:wrote down|read|listed|entered)|"
        r"i signed (?:the |my )?(?:forms?|register|card)|"
        r"(?:the |my )?(?:order )?(?:receipt|profile|badge|roster) (?:uses|shows|says|lists))\s+"
    )),
)
_END = re.compile(
    r"[.!?,;:]|\b(?:by the way|on (?:the|my|weekends?)|at (?:the|my)|to (?:the|my)|"
    r"when|where|because|just before|just after|before|after|during|instead|"
    r"(?:and |but |so )?(?:i|we) (?:was|were|am|have|had|just|usually|called|came|"
    r"received|wanted|started|ended|went|needed|work|think|chose|did|liked|said)|"
    r"i(?:'ve|’ve|’m|'m))\b"
)
_BLOCK = {
    "a", "an", "and", "are", "as", "at", "been", "can", "for", "has", "have", "how", "is",
    "it", "like", "my", "not", "of", "on", "our", "really", "rather", "she", "so",
    "some", "that", "the", "their", "them", "there", "hey", "this", "to", "too",
    "under", "very", "was", "we", "were", "what", "why", "with", "would", "you", "your",
}
_ITEM = re.compile(
    r"\b(?:account number|brand|cart|code|confirmation|coupon|drink|email|flavor|food|identifier|"
    r"id|label|menu|order|password|phone|price|product|promo|receipt number|reference|size|"
    r"total|tracking|username)\b"
)


def _cased_word_starts(view):
    return {
        view.offsets[word.start()]
        for word in _WORD.finditer(view.text)
        if word.group()[0].isupper() and view.offsets[word.start()] is not None
    }


def detect_person_slots(text, view, detections):
    casing = _cased_word_starts(view)
    for category, cue in _SLOT:
        for introduced in cue.finditer(text):
            start = introduced.end()
            end = min(start + 80, len(text))
            stop = _END.search(text, start, end)
            if stop is not None:
                end = stop.start()
            phrase = text[start:end].strip()
            words = list(_WORD.finditer(phrase))
            if not 2 <= len(words) <= 5 or _ITEM.search(phrase):
                continue
            words_text = tuple(word.group() for word in words)
            if words_text[0] in _BLOCK or words_text[-1] in _BLOCK:
                continue
            if " ".join(words_text) != phrase:
                continue
            cased = any(start + word.start() in casing for word in words)
            end = start + len(phrase)
            corroborated = any(
                hit.label in _PERSON and start < hit.end and hit.start < end
                and min(end, hit.end) - max(start, hit.start) >= 3
                for hit in detections
            )
            if category == "introduction" and (not stop or stop.group() != "by the way"):
                continue
            if category != "direct" and not (corroborated or cased):
                continue
            yield Hit("person", start, end)
