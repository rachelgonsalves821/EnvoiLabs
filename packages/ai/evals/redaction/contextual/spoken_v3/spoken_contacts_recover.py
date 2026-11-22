"""Compare bounded recovery of malformed contacts on known spoken transcripts."""

import re

from candidate import Hit
from spoken_contact import tokenize, _NATIVE, _ACOUSTIC, _PIN_SEPARATORS


_REPEAT = {"double": 2, "doubles": 2, "doubled": 2, "triple": 3, "triples": 3, "tripled": 3}
_WEAK_REPEAT = {"devil": 2, "devils": 2, "treble": 3}
_PHONE_INTENT = re.compile(
    r"\b(?:phone|telephone|call\s?back|cell|mobile|area code|"
    r"(?:my|your|their|the) (?:contact )?number|reach me|text me|"
    r"call(?:s|ed)?|dial|ring)\b", re.I,
)
_FALSE_PHONE = re.compile(r"\b(?:order|invoice|receipt|confirmation|tracking|reference|item) (?:id|number|code)\b", re.I)
_PHONE_AFTER = re.compile(r"^\s*(?:for (?:the )?(?:calls?|texts?)|when (?:they|you) asked|if you (?:call|text))\b", re.I)
_LOCAL_START = re.compile(
    r"\b(?:the receipt goes to|replies? (?:go|goes) to|updates? (?:go|goes) to|sent to|"
    r"inbox (?:as|is|was)|(?:email|address) (?:is|was|as)|"
    r"say the emails?(?: slowly)?|says|said|"
    r"i (?:put|used|entered|gave|typed|wrote|use)|(?:write|send|mail) (?:it |a copy )?to|"
    r"have it sent(?: to)?|and then|now use|(?:it's|it is)|use|to|as)\s+", re.I,
)
_EMAIL_INTENT = re.compile(
    r"\b(?:e-?mail|inbox|written repl(?:y|ies)|written updates?|"
    r"mailing list|address|spell it|send a copy|confirmation|account|profile)\b", re.I,
)
_TLDS = {
    "com", "org", "net", "edu", "gov", "test", "invalid", "ca", "co", "io", "uk",
    "us", "info", "me", "biz", "dev", "app", "online",
}
_DOMAIN_BREAK = {"dot", "period", "."}
_HANDLE_BREAK = {
    "dot", "period", "point", "dash", "hyphen", "underscore", "plus", "minus", "slash",
    ".", "-", "_", "+",
}
_WEAK_MAIL_BREAK = {"da", "dah", "that", "dote", "dodd", "got"}
_WEAK_AT = {"and", "an", "in", "said", "set", "ad", "hat", "it", "had", "that", "add"}
_HANDLE_START_BLOCK = {
    "a", "an", "the", "to", "my", "me", "i", "we", "and", "then", "just", "our", "their",
    "email", "address", "inbox", "is", "was", "says", "said", "for", "now",
}
_WEB_ACTION = {"browse", "click", "go", "look", "order", "read", "see", "shop", "view", "visit"}
_WORD = re.compile(r"[^\W_]+(?:[-’'][^\W_]+)*\Z")


def _digit(word):
    if word.isascii() and word.isdigit() and len(word) <= 4:
        return word, len(word)
    if word in _NATIVE:
        return _NATIVE[word], 1
    return _ACOUSTIC.get(word, ""), 0


def _phone_runs(text, tokens):
    cursor = 0
    while cursor < len(tokens):
        first = cursor
        initial = tokens[first]
        international = initial.word in {"plus", "+"}
        first_number = first + int(international)
        if first_number >= len(tokens):
            break
        decoded, quality = _digit(tokens[first_number].word)
        before = text[max(0, initial.start - 72):initial.start]
        phone = max((match.end() for match in _PHONE_INTENT.finditer(before)), default=-1)
        reference = max((match.end() for match in _FALSE_PHONE.finditer(before)), default=-1)
        if reference >= 0 and reference >= phone:
            cursor += 1
            continue
        phone_intent = phone >= 0
        if not decoded or (quality < 1 and not (phone_intent or international)):
            cursor += 1
            continue
        number = ""
        native = 0
        last = first_number
        best = None
        while last < len(tokens) and last < first_number + 20:
            word = tokens[last].word
            if best and _PHONE_AFTER.search(text[tokens[last].start:tokens[last].start + 55]):
                break
            if word in _PIN_SEPARATORS and number:
                last += 1
                continue
            repeat = _REPEAT.get(word) or (_WEAK_REPEAT.get(word) if len(number) >= 3 else None)
            found, spoken = _digit(word)
            end = last + 1
            if repeat and end < len(tokens):
                found, spoken = _digit(tokens[end].word)
                if len(found) != 1:
                    break
                found *= repeat
                spoken *= repeat
                end += 1
            if not found or len(number) + len(found) > (15 if international else 11):
                break
            number += found
            native += spoken
            last = end
            after = text[tokens[last - 1].end:tokens[last - 1].end + 55]
            intent = phone_intent or bool(_PHONE_AFTER.search(after))
            valid_count = (
                10 <= len(number) <= 15 and not number.startswith("0") if international
                else len(number) == 10 or len(number) == 11 and (number.startswith("1") or intent)
            )
            if valid_count and native >= 8 or intent and 7 <= len(number) <= 10 and native >= 7:
                # Prefer a complete number and keep ambiguous trailing homophones outside it.
                if best is None or valid_count or spoken and not best[1]:
                    best = (last, valid_count)
        if not best:
            cursor = max(cursor + 1, last)
            continue
        stop = best[0]
        yield Hit("phone", initial.start, tokens[stop - 1].end)
        cursor = stop


def _email_runs(text, tokens):
    for tld in range(3, len(tokens)):
        context = text[max(0, tokens[tld].start - 100):tokens[tld].end + 45]
        intent = bool(_EMAIL_INTENT.search(context))
        ending = tokens[tld].word
        if ending.removeprefix("dot") in _TLDS and ending.startswith("dot") and intent:
            domain = tld - 1
        else:
            if ending not in _TLDS:
                continue
            sep = tokens[tld - 1].word
            if sep not in _DOMAIN_BREAK and (not intent or sep not in _WEAK_MAIL_BREAK):
                continue
            domain = tld - 2
        for _ in range(2):
            if domain < 3 or tokens[domain - 1].word not in _DOMAIN_BREAK:
                break
            domain -= 2
        if not _WORD.fullmatch(tokens[domain].word):
            continue
        at = domain - 1
        strict = tokens[at].word in {"at", "@"} or tokens[at].word == "sign" and tokens[at - 1].word == "at"
        fuzzy = tokens[at].word in _WEAK_AT
        if not strict and not intent:
            continue
        handle_end = at if strict or fuzzy else domain
        if strict and tokens[at].word == "sign":
            handle_end -= 1
        if handle_end < 1:
            continue
        left_first = max(0, handle_end - 8)
        left = text[tokens[left_first].start:tokens[handle_end - 1].end]
        cue = tuple(_LOCAL_START.finditer(left))
        if cue:
            lower = tokens[left_first].start + cue[-1].end()
            first = next((i for i in range(left_first, handle_end) if tokens[i].start >= lower), handle_end)
        else:
            operators = [i for i in range(max(left_first + 1, handle_end - 6), handle_end) if tokens[i].word in _HANDLE_BREAK]
            if not operators:
                continue
            first = operators[0] - 1
        while first < handle_end and tokens[first].word in _HANDLE_START_BLOCK:
            first += 1
        if not first < handle_end or any(token.word in {",", ":", "!", "?", ";"} for token in tokens[first:handle_end]):
            continue
        # A missing @ is plausible only with a spoken handle operator or a direct email cue.
        explicit_handle = any(token.word in _HANDLE_BREAK for token in tokens[first:handle_end])
        if not explicit_handle and tokens[handle_end - 1].word in _WEB_ACTION:
            continue
        if not strict and not fuzzy and not (explicit_handle or cue and intent and handle_end - first <= 4):
            continue
        yield Hit("email", tokens[first].start, tokens[tld].end)


def recovered_contacts(text):
    tokens = tokenize(text)
    yield from _phone_runs(text, tokens)
    yield from _email_runs(text, tokens)
