"""Protect complete phone spans when speech recognition damages a digit group."""

import re

from candidate import Hit
from spoken_contact import _PIN_SEPARATORS, tokenize
from spoken_contacts_recover import _digit, _FALSE_PHONE, _PHONE_INTENT, _REPEAT, _WEAK_REPEAT


_PHONE_SLOT = re.compile(
    r"\b(?:(?:(?:my|your|their|our) (?:daytime |evening )?|(?:contact|callback|call back|cell|mobile|phone) )"
    r"number (?:is|was)|(?:phone|mobile|callback|call back|area code) (?:is|was)|"
    r"number to (?:dial|call|text) (?:is|was)|"
    r"(?:you (?:have|already have)|note|read back)\s+(?:my|the)\s+(?:phone|cell|mobile)(?: number)?|"
    r"(?:call|text|reach) (?:me|my (?:phone|cell|mobile)) (?:back )?(?:at|on)|"
    r"ring my (?:phone|cell|mobile) (?:at|on)|if you miss me on)\s+"
)
_REFERENCE = re.compile(r"\b(?:stock|product|account|batch|serial|item) (?:number|code|id)\b|\bsku\b", re.I)
_WEAK_PREFIX_CUE = re.compile(r"\b(?:use|shows?)\s+$")
_INTERNATIONAL_PREFIX = {"+", "plus"}
_BOUNDARY = {
    "after", "and", "before", "because", "but", "during", "for", "from", "he", "i", "if",
    "now", "on", "she", "so", "the", "then", "try", "until", "we", "when", "you",
}


def _piece(word):
    return bool(_digit(word)[0] or word in _REPEAT or word in _WEAK_REPEAT)


def _bounded_slot(tokens, start):
    index = start + int(tokens[start].word in _INTERNATIONAL_PREFIX)
    international = index > start
    digits, native, last, gaps = 0, 0, start, 0
    while index < len(tokens) and index - start < 21:
        word = tokens[index].word
        if (word == "or" and 9 <= digits <= 10 and index + 1 < len(tokens)
                and len(_digit(tokens[index + 1].word)[0]) == 1
                and (index + 2 == len(tokens) or tokens[index + 2].word in _BOUNDARY)):
            last = index + 2
            break
        if word in _PIN_SEPARATORS and digits and index + 1 < len(tokens) and _piece(tokens[index + 1].word):
            index += 1
            continue
        repeat = _REPEAT.get(word) or (_WEAK_REPEAT.get(word) if digits else None)
        value, reliable = _digit(word)
        if repeat and index + 1 < len(tokens):
            item = tokens[index + 1].word
            value, reliable = _digit(item)
            if len(value) == 1:
                digits += repeat
                native += reliable * repeat
                index += 2
                last = index
                continue
        if value:
            if digits >= 10 and not reliable and index + 1 < len(tokens) and tokens[index + 1].word in _BOUNDARY:
                break
            digits += len(value)
            native += reliable
            index += 1
            last = index
            continue
        if (digits >= 2 and gaps < 2 and len(word) <= 6 and word.isalpha()
                and word not in _BOUNDARY and index + 1 < len(tokens) and _piece(tokens[index + 1].word)):
            gaps += 1
            digits += 1
            index += 1
            continue
        break
    maximum = 15 if international else 11
    return last if 9 <= digits <= maximum and native >= 7 else start


def recover_number_slots(text):
    tokens = tokenize(text)
    for index, token in enumerate(tokens):
        if index + 1 >= len(tokens) or not (_piece(token.word) or token.word in _INTERNATIONAL_PREFIX):
            continue
        before = text[max(0, token.start - 70):token.start].lower()
        phone_context = tuple(_PHONE_SLOT.finditer(before))
        if phone_context and phone_context[-1].end() == len(before):
            if (_FALSE_PHONE.search(before) or _REFERENCE.search(before)) and not _PHONE_INTENT.search(phone_context[-1].group()):
                continue
            stop = _bounded_slot(tokens, index)
            if stop > index:
                yield Hit("phone", token.start, tokens[stop - 1].end)
        elif (token.word == "for" and _WEAK_PREFIX_CUE.search(before)
              and not _FALSE_PHONE.search(before) and not _REFERENCE.search(before)):
            stop = index + 1
            digits = 0
            while stop < len(tokens):
                digit, native = _digit(tokens[stop].word)
                if not native:
                    break
                digits += len(digit)
                stop += 1
            if digits == 9:
                yield Hit("phone", token.start, tokens[stop - 1].end)
