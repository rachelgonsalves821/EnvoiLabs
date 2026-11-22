"""Recognize contact spans in unpunctuated English speech recognition."""

from dataclasses import dataclass
import re

from candidate import Hit


@dataclass(frozen=True)
class Token:
    word: str
    start: int
    end: int


_TOKEN = re.compile(r"\d+|[^\W\d_]+(?:[’'-][^\W\d_]+)*|[^\w\s]", re.UNICODE)
_NATIVE = {word: str(number) for number, word in enumerate(
    ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine")
)}
_NATIVE.update({"oh": "0", "o": "0"})
_ACOUSTIC = {"to": "2", "too": "2", "for": "4", "fore": "4", "or": "0", "ate": "8", "a": "8"}
_CARDINAL = set(_NATIVE) | {
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
    "eighty", "ninety", "hundred", "thousand",
}
_PIN_SEPARATORS = {",", ".", "(", ")", "-", "‐", "‑", "–", "/"}
_EXTENSIONS = {"ext", "extension", "x"}
_PHONE_CUE = re.compile(r"\b(?:phone|call|call\s?back|cell|mobile|number|dial|text|ring|rang|reach|contact|work line)\b", re.I)
_STRONG_PHONE_CUE = re.compile(r"\b(?:phone|call me|call\s?back|cell|mobile|dial|text|ring|rang|reach|work line)\b", re.I)
_ORDER_CUE = re.compile(r"\b(?:receipt|invoice|tracking|order|confirmation|reference|sku)\b", re.I)
_PRIVATE_CUE = re.compile(r"\b(?:my|your|our|their|his|her) (?:phone|number|cell|mobile)|\b(?:call|text|dial) me\b", re.I)

_TLDS = {"com", "org", "net", "edu", "gov", "test", "ca", "co", "io", "uk", "us", "info", "me", "biz"}
_DOMAIN_SEPARATORS = {"dot", "period", "."}
_STRICT_AT = {"at", "@"}
_FUZZY_AT = {"and", "set", "hat", "ad"}
_MAIL_CONTEXT = re.compile(r"\b(?:email|e-mail|address|inbox|invoice|confirmation|receipt|contact|send|give|enter(?:ed)?|check\s?out|write|text|message|reach)\b", re.I)
_HANDLE_OPERATORS = {"dot", "dash", "hyphen", "period", "underscore", "plus", "minus", ".", "-", "+", "_"}
_LOCAL_CUE = re.compile(
    r"\b(?:put|typed|type|entered|enter|wrote|write|used|use|"
    r"send(?: it)? to|went to|go(?:es)? to|gave (?:them|him|her)|"
    r"(?:reached?|email(?:ed)?|writ(?:e|ten)|reach) me at|"
    r"is|was|with|his|as|it's|it’s|to|my email)\s+", re.I,
)
_LOCAL_PREFIX = {
    "my", "our", "your", "their", "email", "inbox", "address", "for", "me",
    "a", "an", "the", "by", "the", "it", "that", "them", "just",
}

_STREET_SUFFIXES = {
    "street", "st", "avenue", "ave", "road", "rd", "drive", "dr", "lane", "ln", "boulevard",
    "blvd", "court", "ct", "way", "place", "pl", "terrace", "ter", "circle", "cir",
    "parkway", "pkwy", "highway", "hwy", "trail", "trl", "alley", "row", "loop",
    "square", "sq", "crescent", "close", "mews",
}
_UNITS = {"apartment", "apt", "suite", "sweet", "unit", "floor", "building", "flat", "room", "#"}
_STREET_BREAK = {"the", "it", "my", "your", "we", "i", "they", "that", "then", "was", "is", "had", "said"}
_ADDRESS_CUE = re.compile(
    r"\b(?:address|deliver\w*|driver|mail\w*|order (?:at|to)|door is at|"
    r"(?:live|lived|staying|stay) at|my (?:house|home|apartment)|street|send it|box number)\b", re.I,
)
_UNIT_LETTERS = {"ay", "bee", "be", "cee", "dee", "gee", "eff", "kay", "el"}


def tokenize(text):
    return [Token(item.group().casefold(), item.start(), item.end()) for item in _TOKEN.finditer(text)]


def _span(label, tokens, first, stop):
    return Hit(label, tokens[first].start, tokens[stop - 1].end)


def _digit(word):
    if word.isascii() and word.isdigit() and len(word) <= 4:
        return word, len(word)
    if word in _NATIVE:
        return _NATIVE[word], 1
    if word in _ACOUSTIC:
        return _ACOUSTIC[word], 0
    return "", 0


def _phone_hits(text, tokens):
    index = 0
    while index < len(tokens):
        current = tokens[index]
        if not _digit(current.word)[0]:
            index += 1
            continue
        if current.word == "to" and index and tokens[index - 1].word in {
            "go", "went", "phone", "number", "cell", "line", "call", "sent", "send",
        }:
            index += 1
            continue
        lookbehind = text[max(0, current.start - 85):current.start]
        digits, native, last = "", 0, index
        accepted = None
        for offset in range(index, min(index + 23, len(tokens))):
            token = tokens[offset].word
            if token in _PIN_SEPARATORS:
                continue
            decoded, quality = _digit(token)
            if not decoded or len(digits) + len(decoded) > 11:
                break
            digits += decoded
            native += quality
            last = offset + 1
            vicinity = lookbehind + " " + text[tokens[offset].end:tokens[offset].end + 60]
            contextual = bool(_PHONE_CUE.search(vicinity))
            if _ORDER_CUE.search(lookbehind) and not (_PRIVATE_CUE.search(vicinity) or _STRONG_PHONE_CUE.search(vicinity)):
                continue
            if native < (len(digits) if not contextual else len(digits) - 2):
                continue
            if len(digits) == 10 or (len(digits) == 11 and digits.startswith("1")) or (len(digits) == 7 and contextual):
                accepted = last
        if accepted is None:
            index += 1
            continue
        if accepted < len(tokens) and tokens[accepted].word in _EXTENSIONS:
            extension = _number_end(tokens, accepted + 1, allow_acoustic=True, limit=4)
            if extension > accepted + 1:
                accepted = extension
        yield _span("phone", tokens, index, accepted)
        index = accepted


def _email_hits(text, tokens):
    for index in range(3, len(tokens)):
        if tokens[index].word not in _TLDS or tokens[index - 1].word not in _DOMAIN_SEPARATORS:
            continue
        domain_start = index - 2
        for _ in range(3):
            if domain_start < 3 or tokens[domain_start - 1].word not in _DOMAIN_SEPARATORS:
                break
            domain_start -= 2
        at = domain_start - 1
        if at <= 0:
            continue
        marker = tokens[at].word
        local_first = max(0, at - 8)
        vicinity = text[max(0, tokens[at].start - 90):min(len(text), tokens[index].end + 70)]
        if marker not in _STRICT_AT and (marker not in _FUZZY_AT or not _MAIL_CONTEXT.search(vicinity)):
            continue
        for offset in range(at - 1, local_first - 1, -1):
            if tokens[offset].word in (".", "!", "?", ";", ":", ",") and offset >= at - 4:
                local_first = offset + 1
                break
        left = text[tokens[local_first].start:tokens[at].start]
        cue = tuple(_LOCAL_CUE.finditer(left))
        if cue:
            start = tokens[local_first].start + cue[-1].end()
            local_first = next((i for i in range(local_first, at) if tokens[i].start >= start), at)
        else:
            operator = next((i for i in range(max(local_first + 1, at - 5), at) if tokens[i].word in _HANDLE_OPERATORS), None)
            local_first = operator - 1 if operator is not None else max(local_first, at - (5 if _MAIL_CONTEXT.search(vicinity) else 2))
        while local_first < at and tokens[local_first].word in _LOCAL_PREFIX:
            local_first += 1
        if local_first < at:
            yield _span("email", tokens, local_first, index + 1)


def _number_end(tokens, start, *, allow_acoustic=False, limit=6):
    index = start
    stop = min(start + limit, len(tokens))
    while index < stop:
        word = tokens[index].word
        if word == "and" and index > start and index + 1 < stop and tokens[index + 1].word in _CARDINAL:
            index += 1
            continue
        if word.isascii() and word.isdigit() or word in _CARDINAL or (allow_acoustic and word in _ACOUSTIC):
            index += 1
            continue
        break
    return index


def _address_end(tokens, stop):
    if stop < len(tokens) and tokens[stop].word == ",":
        stop += 1
    if stop >= len(tokens) or tokens[stop].word not in _UNITS:
        return stop - 1 if stop > 0 and tokens[stop - 1].word == "," else stop
    first = stop + 1
    if first < len(tokens) and tokens[first].word == "#":
        first += 1
    end = _number_end(tokens, first, allow_acoustic=True, limit=4)
    if end == first and first < len(tokens) and (len(tokens[first].word) == 1 or tokens[first].word in _UNIT_LETTERS):
        end = first + 1
    elif end > first and end < len(tokens) and (tokens[end].word in _UNIT_LETTERS or tokens[end].word in {"a", "b", "c", "d", "e", "f"}):
        end += 1
    return end if end > first else stop


def _address_hits(text, tokens):
    for start, token in enumerate(tokens):
        opener = tuple(item.word for item in tokens[start:start + 3])
        if opener in (("p", "o", "box"), ("post", "office", "box")):
            end = _number_end(tokens, start + 3, allow_acoustic=True)
            if end > start + 3:
                yield _span("address", tokens, start, end)
            continue
        number_end = _number_end(tokens, start)
        if number_end == start or (start and _number_end(tokens, start - 1) > start):
            continue
        end = None
        for index in range(number_end, min(number_end + 7, len(tokens))):
            word = tokens[index].word
            if word in _STREET_BREAK or len(word) == 1 and not word.isalpha():
                break
            if index > number_end:
                vicinity = text[max(0, token.start - 90):tokens[index].end + 40]
                next_is_unit = index + 1 < len(tokens) and tokens[index + 1].word in _UNITS
                similar_suffix = next_is_unit and _ADDRESS_CUE.search(vicinity) and any(
                    len(suffix) >= 5 and word.startswith(suffix[:4]) for suffix in _STREET_SUFFIXES
                )
                if word in _STREET_SUFFIXES or similar_suffix:
                    end = _address_end(tokens, index + 1)
                    if end > index + 1:
                        break
        if end is not None:
            yield _span("address", tokens, start, end)


def spoken_contact_hits(text):
    tokens = tokenize(text)
    yield from _phone_hits(text, tokens)
    yield from _email_hits(text, tokens)
    yield from _address_hits(text, tokens)
