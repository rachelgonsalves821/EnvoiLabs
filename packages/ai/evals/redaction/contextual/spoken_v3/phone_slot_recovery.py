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
_LITERAL_00 = re.compile(
    r"00[ \t\u00a0]*[1-9][0-9]*"
    r"(?:[ \t\u00a0.\-‐‑–]+[0-9]+|[ \t\u00a0]*\([0-9]{1,4}\)[0-9]*){0,10}"
)
_BOUNDARY = {
    "after", "and", "before", "because", "but", "during", "for", "from", "he", "i", "if",
    "now", "on", "she", "so", "the", "then", "try", "until", "we", "when", "you",
}
_EXPLICIT_NUMBER = re.compile(
    r"\b(?:(?:the |my |our |your )?number (?:with (?:the|my|our) (?:new )?area code|for (?:calls?|texts?)) (?:is|was)|"
    r"(?:the |my |our )?(?:phone|mobile|callback|contact number) for (?:pick ?up|delivery|follow[ -]?up|scheduling)(?: is| was)?|"
    r"(?:my|their|our|your) (?:(?:daytime|evening|international) )?(?:contact|telephone|work|phone|callback|mobile)(?: number)? (?:is|was)|"
    r"(?:call|dial|ring|text) (?:me|my (?:(?:private|local|work|mobile) )?(?:cell|phone|number))(?: at| on)?|"
    r"(?:the )?(?:alternate|backup) number to (?:call|dial|text) (?:is|was))\s*(?::\s*|\s+)$"
)
_CONTACT_HANDOFF = re.compile(
    r"\b(?:(?:i|we) (?:used|gave them|left|gave you)|for (?:the )?follow[ -]?up (?:is|at)|"
    r"(?:reach|call|text) (?:me|us) (?:at|on))\s+$"
)
_PHONE_PURPOSE = re.compile(r"^(?:for|four) (?:the )?(?:calls?|texts?|callback)\b")
_END_PHONE = re.compile(r"^(?:[.!?,;:]|(?:i|we|you|they|he|she|the|my|our|your|their|it)\b|"
                        r"(?:after|before|because|until|then|and|but|when|for|send|put|keep|leave|please)\b)")
_LOCAL_PHONE = re.compile(r"\blocal (?:phone|number)\b")
_EXTRA_HOMOPHONES = {"eve": "8", "own": "1", "free": "3", "fife": "5", "threw": "3", "sicks": "6"}
_EXTRA_REPEATS = {"trubble": 3}


def _international_length(digits):
    return 10 <= len(digits) <= 15


def _literal_00_end(text, start):
    match = _LITERAL_00.match(text, start, start + 64)
    if not match:
        return None
    rest = text[match.end():].lstrip().casefold()
    if rest and not _END_PHONE.match(rest):
        return None

    from phonenumbers import NumberParseException, is_possible_number, national_significant_number, parse

    try:
        number = parse("+" + match.group()[2:].lstrip(), None)
    except NumberParseException:
        return None
    digits = str(number.country_code) + national_significant_number(number)
    return match.end() if _international_length(digits) and is_possible_number(number) else None


def _phone_end(tokens, start, explicit, local, text):
    index = start + int(tokens[start].word in _INTERNATIONAL_PREFIX)
    international = index > start
    digits, reliable, repeat_groups = "", 0, 0
    damaged = False
    best = start
    while index < len(tokens) and index - start < 22:
        word = tokens[index].word
        repeat = _REPEAT.get(word) or _WEAK_REPEAT.get(word) or (_EXTRA_REPEATS.get(word) if explicit else None)
        following = tokens[index + 1].word if index + 1 < len(tokens) else ""
        if _PHONE_PURPOSE.match(text[tokens[index].start:].casefold()):
            break
        if word in _PIN_SEPARATORS and digits and _piece(following):
            index += 1
            continue
        if word == "or" and explicit and best == index:
            alternate = _digit(following)[0] or _EXTRA_HOMOPHONES.get(following, "")
            right = text[tokens[index + 1].end:].lstrip().casefold() if following else ""
            if len(alternate) == 1 and (not right or _END_PHONE.match(right)):
                best = index + 2
            break
        value, strength = _digit(following if repeat else word)
        if not value and explicit:
            value = _EXTRA_HOMOPHONES.get(following if repeat else word, "")
        if (repeat and not value and explicit and not damaged and len(digits) >= 5
                and following.isalpha() and following not in _BOUNDARY and len(following) <= 10
                and index + 2 < len(tokens) and _piece(tokens[index + 2].word)):
            value, damaged = "0", True
        if not repeat and not value and explicit and not damaged and word == "i" and len(digits) >= 5:
            if following in _REPEAT or following in _WEAK_REPEAT:
                value, damaged = "0", True
        if not value or (repeat and len(value) != 1):
            break
        count = repeat or 1
        digits += value * count
        reliable += strength * count
        repeat_groups += bool(repeat)
        index += 2 if repeat else 1
        rest = text[tokens[index - 1].end:].lstrip().casefold()
        end = not rest or _END_PHONE.match(rest) or _PHONE_PURPOSE.match(rest)
        valid_count = _international_length(digits) if international else (
            len(digits) == 10 or (local and len(digits) == 7) or (len(digits) == 11 and digits.startswith(("0", "1")))
        )
        if word != "or" and valid_count and reliable >= 7 and (end or explicit and rest.startswith("or ")) and (
            explicit or repeat_groups or reliable >= 9
        ):
            best = index
    return best


def recover_corroborated_numbers(text, mailboxes):
    """Recover a bounded phone value without requiring exact recognized digits."""
    tokens = tokenize(text)
    for start, token in enumerate(tokens):
        literal_00 = token.word.startswith("00")
        if not (literal_00 or _piece(token.word) or token.word in _INTERNATIONAL_PREFIX or token.word in _EXTRA_HOMOPHONES):
            continue
        before = text[max(0, token.start - 100):token.start].casefold()
        label = _EXPLICIT_NUMBER.search(before) or next(
            (match for match in _PHONE_SLOT.finditer(before) if match.end() == len(before)), None,
        )
        explicit = label is not None
        handoff = bool(_CONTACT_HANDOFF.search(before))
        if not (explicit or handoff):
            continue
        if not explicit and (_FALSE_PHONE.search(before) or _REFERENCE.search(before)):
            continue
        if explicit and literal_00:
            literal_end = _literal_00_end(text, token.start)
            if literal_end is not None:
                yield Hit("phone", token.start, literal_end)
                continue
        stop = _phone_end(tokens, start, explicit, bool(label and _LOCAL_PHONE.search(label.group())), text)
        if stop <= start:
            continue
        end = tokens[stop - 1].end
        corroborated = _PHONE_PURPOSE.match(text[end:].lstrip().casefold()) or any(
            0 <= mailbox.start - end <= 50 for mailbox in mailboxes
        )
        if explicit or corroborated:
            yield Hit("phone", token.start, end)


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
