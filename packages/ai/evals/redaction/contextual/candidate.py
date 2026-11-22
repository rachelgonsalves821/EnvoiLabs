"""Offline development recognizers for transcript contact data and explicit introductions."""

from dataclasses import dataclass
import re


@dataclass(frozen=True)
class Hit:
    label: str
    start: int
    end: int


_FLAGS = re.IGNORECASE
_SEPARATOR = r"[ \t,./‐‑–-]*"
_DIGITS = r"(?:zero|oh|o|one|two|three|four|five|six|seven|eight|nine)"
_DIGIT_PART = rf"(?:(?:double|triple)\s+{_DIGITS}|{_DIGITS}|\d{{1,4}})"
_EXTENSION = r"(?:\s*(?:,|\s)?\s*(?:ext(?:ension)?\.?|x)\s*\d{1,6})?"
_NUMERIC_PHONE = re.compile(
    rf"(?<!\w)(?:\+?1{_SEPARATOR})?(?:\(\d{{3}}\)|\d{{3}}){_SEPARATOR}\d{{3}}{_SEPARATOR}\d{{4}}"
    rf"{_EXTENSION}(?!\w)", _FLAGS,
)
_LOCAL_PHONE = re.compile(rf"(?<![\w/])\d{{3}}[ \t.‐‑–-]+\d{{4}}{_EXTENSION}(?![\w/])", _FLAGS)
_SPOKEN_PHONE = re.compile(
    rf"(?<![\w./])(?:\+?1\s+)?{_DIGIT_PART}(?:[ \t,./‐‑–-]+{_DIGIT_PART}){{1,19}}"
    rf"(?:\s*,?\s*(?:extension|ext\.?|x)\s+{_DIGIT_PART}(?:[ \t-]+{_DIGIT_PART}){{0,4}})?(?!\w)",
    _FLAGS,
)
_DIGIT_TOKEN = re.compile(rf"\d+|{_DIGITS}|\b(?:double|triple)\b", _FLAGS)
_PHONE_CUE = re.compile(r"\b(?:phone|telephone|mobile|contact|number|dial|text|call|reach)\b", _FLAGS)
_PHONE_COUNTER_CUE = re.compile(
    r"\b(?:order|invoice|receipt|order id|tracking|confirmation|reference|sku)\b[^.!?;]{0,22}$", _FLAGS,
)
_DIRECT_PHONE_CUE = re.compile(r"\b(?:(?:my|our|your|their|his|her) (?:phone|mobile|number)|dial|call me|text me)\b", _FLAGS)

_DOT = r"(?:\.|\s+(?:dot|\(dot\)|\[dot\])\s+)"
_AT = r"(?:\s*@\s*|\s+(?:at|\(at\)|\[at\])\s+)"
_EMAIL_ATOM = r"[\w%+-]+(?:\.[\w%+-]+)*"
_EMAIL_PUNCTUATION = r"(?:dot|underscore|dash|hyphen|plus|period|minus)"
_MAIL_DOMAIN = rf"(?:[a-z0-9](?:[a-z0-9-]{{0,61}}[a-z0-9])?{_DOT}){{1,4}}(?:com|org|net|edu|gov|test|ca|co|io|uk|us|info|me|biz|onmicrosoft)"
_EMAIL = re.compile(
    rf"(?<![\w@%+.-]){_EMAIL_ATOM}(?:\s+{_EMAIL_PUNCTUATION}\s+{_EMAIL_ATOM}){{0,6}}{_AT}{_MAIL_DOMAIN}(?![\w-])",
    _FLAGS,
)
_EMAIL_LEFT_CUE = re.compile(
    r"\b(?:email(?: address)? (?:is|was)|e-mail(?: address)? (?:is|was)|"
    r"(?:addressed|emailed|sent it|messaged|wrote|write|send|send it) to|"
    r"(?:i|we) used)\s+(?P<words>[\w%+-]+(?:\s+[\w%+-]+){0,2})\s+$", _FLAGS,
)
_MAIL_LEFT_STOP = {"a", "an", "the", "to", "i", "my", "we", "our", "and", "it"}

_DIRECTION = r"(?:north(?:east|west)?|south(?:east|west)?|east|west|[NSEW]\.?)"
_STREET_WORD = r"(?:[^\W\d_]+(?:[.'’‐-][^\W\d_]+)*|(?:st|mt)\.)"
_STREET_SUFFIX = (
    r"(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|"
    r"boulevard|blvd\.?|court|ct\.?|way|place|pl\.?|terrace|ter\.?|"
    r"circle|cir\.?|parkway|pkwy\.?|highway|hwy\.?|trail|trl\.?|"
    r"alley|row|loop|square|sq\.?|crescent|close|mews)"
)
_UNIT_NUMBER = r"(?:[a-z]?\d{1,8}[a-z]?|[a-z])(?:\s*[-/]\s*[a-z0-9]{1,8})?"
_UNIT = rf"(?:\s*,?\s+(?:apartment|apt\.?|suite|ste\.?|unit|floor|fl\.?|building|bldg\.?|flat|room|rm\.?)\s*#?\s+{_UNIT_NUMBER}|\s*,?\s*#\s*{_UNIT_NUMBER})(?!\w)"
_CARDINAL = r"(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and)"
_STREET = re.compile(
    rf"(?<![\w.])(?P<number>\d{{1,6}}[a-z]?|{_CARDINAL}(?:[ -]{_CARDINAL}){{0,5}})\s+"
    rf"(?:{_DIRECTION}\s+)?(?:{_STREET_WORD}\s+){{1,5}}{_STREET_SUFFIX}"
    rf"(?!\w)(?:\s+{_DIRECTION}(?!\w))?(?:{_UNIT}){{0,2}}", _FLAGS,
)
_BOX = re.compile(
    rf"\b(?:p\s*\.?\s*o\.?|post\s+office)\s+box\s+(?:no\.?\s+|number\s+)?"
    rf"(?:\d{{1,8}}[a-z]?|{_CARDINAL}(?:[ -]{_CARDINAL}){{0,5}})\b", _FLAGS,
)
_SPOKEN_ADDRESS_CUE = re.compile(
    r"\b(?:address|drop(?:ped)?(?: it)? (?:by|at)|deliver(?:ed|y)?(?: it)? (?:to|at)|"
    r"destination(?: was| is)?|staying at|live at|lived at|mail(?:ing)? (?:to|at)|send it to)\b", _FLAGS,
)

_IDENTITY_VALUE = r"(?P<value>[^\n!?;:.,]{2,90})"
_IDENTITY_RULES = {
    "person": re.compile(
        r"\b(?:my (?:full |first |last )?name (?:is|was)|"
        r"(?:i|they) (?:go|went) by|i (?:introduced|identified) myself as|"
        r"(?:they|she|he) filed it under|the account (?:showed|listed)|"
        r"the name on (?:the|my) (?:account|order) (?:was|is)|please call me)\s+"
        + _IDENTITY_VALUE, _FLAGS,
    ),
    "organization": re.compile(
        r"\b(?:my employer(?:'s name)? (?:is|was)|(?:i|we) (?:work|worked) for|"
        r"(?:i|we) (?:work|worked) at|my (?:pay|paycheck) comes from|"
        r"i (?:was|am) on a shift at|my team worked at|i have a job at|"
        r"(?:i|we) (?:attend|attended|study at|studied at)|my class was at)\s+"
        + _IDENTITY_VALUE, _FLAGS,
    ),
}
_CLAUSE = re.compile(
    r"\b(?:(?:and|but|then|while|so)\s+(?:i|we|they|he|she|my|our|the)|"
    r"because|since|during|when|where|before|after|near|this morning|last year|today|yesterday)\b", _FLAGS,
)
_NON_IDENTITY_START = re.compile(r"^(?:a|an|the|this|that|some|my|our|your|today|yesterday|\d+)\b", _FLAGS)
_PRODUCT_BEFORE = re.compile(
    r"\b(?:menu called (?:it|this)|menu item was|button said|banner said|"
    r"product called|flavor was|picked the dish)\s+['\"“]?$", _FLAGS,
)
_PRODUCT_AFTER = re.compile(r"^['\"”]?\s+(?:from the (?:menu|drinks menu)|on the (?:menu|checkout screen))\b", _FLAGS)


def _left(text, start, width=75):
    return re.split(r"[.!?;\n]", text[max(0, start - width):start])[-1]


def _spoken_digits(text):
    head = re.split(r"(?:\bext(?:ension)?\.?|(?<!\w)x)\s", text, maxsplit=1, flags=_FLAGS)[0]
    count, repeat = 0, 1
    for token in _DIGIT_TOKEN.findall(head.lower()):
        if token in ("double", "triple"):
            repeat = 2 if token == "double" else 3
        else:
            count += len(token) if token.isdigit() else repeat
            repeat = 1
    return count


def _phone_context(text, start):
    left = _left(text, start)
    return bool(_PHONE_CUE.search(left)) and not _number_is_reference(left)


def _number_is_reference(left):
    return bool(_PHONE_COUNTER_CUE.search(left) and not _DIRECT_PHONE_CUE.search(left))


def _phone_hits(text):
    for pattern in (_NUMERIC_PHONE, _LOCAL_PHONE, _SPOKEN_PHONE):
        for match in pattern.finditer(text):
            rendered = match.group()
            main = re.split(r"(?:\bext(?:ension)?\.?|(?<!\w)x)\s", rendered, maxsplit=1, flags=_FLAGS)[0]
            digits = _spoken_digits(rendered)
            if digits not in (7, 10, 11):
                continue
            nearby = _phone_context(text, match.start())
            if _number_is_reference(_left(text, match.start())):
                continue
            if (pattern is _LOCAL_PHONE or digits == 7 or main.isdigit()) and not nearby:
                continue
            yield Hit("phone", match.start(), match.end())


def _email_hits(text):
    for match in _EMAIL.finditer(text):
        start = match.start()
        preceding = _left(text, start)
        supplied = _EMAIL_LEFT_CUE.search(preceding)
        if supplied and not any(word.lower() in _MAIL_LEFT_STOP for word in supplied["words"].split()):
            start -= len(preceding) - supplied.start("words")
        yield Hit("email", start, match.end())


def _address_hits(text):
    for match in _STREET.finditer(text):
        if match["number"][0].isdigit() or _SPOKEN_ADDRESS_CUE.search(_left(text, match.start())):
            yield Hit("address", match.start(), match.end())
    for match in _BOX.finditer(text):
        yield Hit("address", match.start(), match.end())


def _identity_hits(text):
    for label, pattern in _IDENTITY_RULES.items():
        for match in pattern.finditer(text):
            value = _CLAUSE.split(match["value"], maxsplit=1)[0].rstrip()
            if not value or _NON_IDENTITY_START.match(value):
                continue
            if not re.fullmatch(r"[^\W\d_]+(?:['’ .&‐-][^\W\d_]+){0,8}", value):
                continue
            yield Hit(label, match.start("value"), match.start("value") + len(value))


def candidate_hits(text, deterministic, model):
    """Combine contact rules with the pinned deterministic and contextual models."""
    yield from _phone_hits(text)
    yield from _email_hits(text)
    yield from _address_hits(text)
    yield from _identity_hits(text)
    for hit in (*deterministic, *model):
        if hit.label in ("ORGANIZATION", "organization"):
            if _PRODUCT_BEFORE.search(_left(text, hit.start)) or _PRODUCT_AFTER.search(text[hit.end:hit.end + 35]):
                continue
        if hit.label in ("PHONE_NUMBER", "phone number") and _number_is_reference(_left(text, hit.start)):
            continue
        yield hit


def mask(text, hits, character="\uE000"):
    """Use the union of validated source spans without changing evidence offsets."""
    result = list(text)
    for hit in hits:
        if not 0 <= hit.start < hit.end <= len(text):
            raise ValueError("Recognizer returned an invalid source span")
        result[hit.start:hit.end] = [character] * (hit.end - hit.start)
    return "".join(result)
