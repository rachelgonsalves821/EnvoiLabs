"""Recover street-address spans introduced by a private location or delivery cue."""

import re

from candidate import Hit
from spoken_contact import _CARDINAL, _STREET_SUFFIXES, _address_end, _digit, _number_end, tokenize


_PRIVATE_LOCATION = re.compile(
    r"\b(?:(?:my|our) (?:(?:reference|home|mailing|shipping|billing|street|delivery|private drop off) )?"
    r"address(?:es| (?:is|was|would be|at))?|"
    r"(?:the )?(?:return address(?: on [^,.!?;]{1,35}?)?|address for (?:this|the) delivery) (?:is|was)|"
    r"(?:my|our) (?:apartment|house|home|doorway) (?:at|is(?: at)?)|"
    r"(?:i|we) (?:live|lived|stay|stayed) at|where (?:i|we) live is|"
    r"the place (?:i(?:['’]m|m)|we(?:['’]re|re)) (?:renting|staying) (?:is|was)|"
    r"(?:the )?(?:billing|delivery|mailing) form (?:lists|says|shows)|"
    r"(?:the store|driver|courier|carrier) (?:dropped it|left it|delivered it) at|"
    r"(?:drop|leave) (?:it|(?:the|my|our) (?:parcel|packages?|order|boxes)) (?:at|by)|"
    r"(?:mail|ship|send|post) (?:it|(?:the|my|our) (?:paperwork|letter|packet|package|(?:sample )?card)) to|"
    r"(?:parcel|package|order) should come to|(?:drops?|delivers?|leaves?) (?:mine|ours) at|"
    r"(?:deliver|delivery) (?:to my address at|use))\s*[,:]?\s+", re.I,
)
_DESTINATION = re.compile(
    r"\b(?:ended up (?:at|outside)|(?:shared|split|took) a ride to|"
    r"(?:driver|courier)[^.!?;]{0,52}?\bstop (?:at|it))\s+", re.I,
)
_CLAUSE_END = re.compile(
    r"[,.!?;:]|\b(?:at the time|for (?:the|my|our)|before|after|by heart|"
    r"(?:i|we|they|he|she) (?:was|were|am|are|walked|called|took)|"
    r"and (?:i|we|they|the|then)|when|which|because|then)\b", re.I,
)
_MISHEARD_SUFFIX = {"rode", "lain", "terris"}
_MISHEARD_DIGIT = {"tree", "aid", "won"}
_EXTRA_UNITS = {"block", "tower"}
_UNIT_LETTER_VARIANTS = {"bee", "be", "see", "cee", "dee", "eff", "gee"}
_NON_ADDRESS = re.compile(
    r"\b(?:a\s?m|p\s?m|o['’]?clock|today|tomorrow|afternoon|evening|morning|tonight|minutes?|"
    r"dollars?|cents?|route|mile marker|tracking|order (?:code|number)|receipt (?:code|number))\b",
    re.I,
)


def _house_number_end(tokens, start):
    index = start
    reliable = 0
    while index < len(tokens) and index - start < 6:
        word = tokens[index].word
        decoded, confidence = _digit(word)
        if decoded or word in _CARDINAL:
            reliable += max(confidence, int(word in _CARDINAL))
        elif not (word in _MISHEARD_DIGIT and (
            reliable >= 2 or (index + 1 < len(tokens) and _digit(tokens[index + 1].word)[0])
        )):
            break
        index += 1
    return index, reliable


def _street_end(tokens, first, limit, private):
    for index in range(first + 1, min(limit, first + 5)):
        word = tokens[index].word
        if word in _STREET_SUFFIXES or (private and word in _MISHEARD_SUFFIX):
            return index + 1
        if private and word == "a" and index + 1 < limit and tokens[index + 1].word == "venue":
            return index + 2
    return first


def _unit_end(tokens, street_end):
    end = street_end
    for _ in range(3):
        next_end = _address_end(tokens, end)
        if next_end == end and end + 1 < len(tokens) and tokens[end].word in _EXTRA_UNITS:
            first = end + 1
            next_end = _number_end(tokens, first, allow_acoustic=True, limit=4)
            if next_end == first:
                word = tokens[first].word
                next_end = first + 1 if word in _UNIT_LETTER_VARIANTS or len(word) == 1 and word.isalpha() else end
        if next_end <= end:
            break
        end = next_end
    return end


def recover_address_slots(text):
    tokens = tokenize(text)
    offsets = {token.start: index for index, token in enumerate(tokens)}
    for cue in (_PRIVATE_LOCATION, _DESTINATION):
        private = cue is _PRIVATE_LOCATION
        for prefix in cue.finditer(text):
            start = offsets.get(prefix.end())
            if start is None:
                continue
            first, reliable = _house_number_end(tokens, start)
            parts = first - start
            if not parts or parts > 5 or (parts == 1 and not tokens[start].word.isdigit()):
                continue
            stop = min(len(text), prefix.end() + 86)
            boundary = _CLAUSE_END.search(text, prefix.end(), stop)
            stop = boundary.start() if boundary else stop
            limit = first
            while limit < len(tokens) and tokens[limit].end <= stop:
                limit += 1
            tail = text[tokens[first - 1].end:stop]
            end = _street_end(tokens, first, limit, private)
            if end > first and (reliable or private or parts >= 3):
                if _NON_ADDRESS.search(text[tokens[first - 1].end:tokens[end - 1].end]):
                    continue
                end = _unit_end(tokens, end)
            elif private and reliable >= 2 and parts >= 2 and not _NON_ADDRESS.search(tail):
                end = next((unit for index in range(first + 2, min(limit, first + 6))
                            if (unit := _unit_end(tokens, index)) > index), limit)
                if end == limit and not 2 <= limit - first <= 5:
                    continue
            else:
                continue
            yield Hit("address", tokens[start].start, tokens[end - 1].end)
