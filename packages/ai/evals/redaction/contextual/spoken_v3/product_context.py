"""Recognize model detections attached to explicit product or menu labels."""

import re

_PRIVATE_ROLE = re.compile(
    r"\b(?:employer|work(?:ed|ing)? (?:at|for)|company (?:i|we) work|"
    r"(?:my|our) (?:name|workplace|school|employer)|student at|study at|"
    r"(?:i am|i'm|she's|he's) named|name on (?:the|my)|(?:driver|courier) (?:is|was) named)\b",
    re.I,
)
_TITLE_PREFIX = re.compile(
    r"\b(?:(?:the )?(?:menu|menu label) (?:was|said|listed|called (?:it|this))|"
    r"(?:the )?(?:shop|cafe|restaurant|item|dish|coffee|flavor) (?:was|is) called|"
    r"(?:the )?app called it|picked the dish|the store (?:was|is) called|"
    r"(?:the )?(?:menu|dish) (?:showed|displayed|said))\s+[“'\"\s]*$",
    re.I,
)
_TITLE_SUFFIX = re.compile(
    r"^[”'\"\s]*(?:on the (?:menu|checkout screen)|from the (?:menu|drinks menu)|"
    r"because that was what the menu called it)\b",
    re.I,
)
_IDENTITY_LABELS = {"person", "organization", "name", "organization educational"}
_PRIVATE_ASSERTION = re.compile(
    r"\b(?:(?:my|his|her|their|our) (?:full |legal |printed )?name|"
    r"(?:my|his|her|their|our) (?:employer|workplace|school|university)|"
    r"(?:i|we) (?:work|worked|study|studied) (?:at|for))\b", re.I,
)
_COMMERCIAL_LABEL = re.compile(
    r"^\s+(?:(?:deal|offer|bundle|model|flavor)\s+)?(?:"
    r"(?:(?:which|that) (?:is|was)|as) (?:the|a) "
    r"(?:(?:sample )?(?:item|product|package|basket|bundle) (?:name|label)|"
    r"(?:\w+ )?model|public supplier)|"
    r"(?:is|was) the name (?:the (?:shop|store|cafe) gave (?:the|this) (?:blend|item|bundle)|"
    r"printed on the receipt for (?:the|a) (?:special|(?:\w+ )?special))"
    r")\b", re.I,
)
_DEMO = re.compile(r"\b(?:tutorial|demo|example|walkthrough)\b", re.I)
_SAMPLE_WORKPLACE = re.compile(r"^\s+as (?:a|the) sample workplace\b", re.I)
_GENERIC_MENTION = re.compile(r"(?:the |this |that )?(?:shop|store|cafe|host|clerk|cashier)\Z", re.I)
_DETERMINER = re.compile(r"\b(?:the|this|that)\s+$", re.I)
_OCCUPATION = re.compile(
    r"(?:(?:a|an|the|this|that)\s+)?(?:technician|inspector|driver|courier|worker|clerk|cashier)", re.I,
)
_OCCUPATION_PREFIX = re.compile(r"\b(?:a|an|the|this|that)\s+$", re.I)
_PUBLIC_ORGANIZATION = re.compile(
    r"\b(?:looked up|found|searched for)\s+(?P<directory>[^!?;:\n]{3,85}?)\s+"
    r"in (?:an? |the )?public (?:[\w-]+ ){0,3}directory\b|"
    r"\b(?:the )?(?:packing slip|shipping label|delivery notice) (?:lists?|names?|shows?)\s+"
    r"(?P<carrier>[^!?;:\n]{3,85}?)\s+as (?:the |a )?(?:carrier|delivery service|courier)\b", re.I,
)
_ORGANIZATION_LABELS = {"organization", "organization educational"}
_LEGAL_ORGANIZATION = re.compile(r"\b(?:co|corp|inc|llc|llp|ltd|limited|incorporated)\.?\s*$", re.I)
_RECEIPT_SELLER = re.compile(
    r"\b(?:the )?(?:(?:checkout|order|purchase|sales) )?receipt (?:lists|names|shows)[ \t]+"
    r"(?P<seller>[^,!?;:\r\n]{5,75}?)[ \t]+as (?:the|a) (?:seller|merchant|vendor)\b"
    r"(?=[ \t]*(?:[.!?]|$))",
    re.I,
)
_SELLER_COMPANY = re.compile(
    r"(?:[^\W\d_]+(?:['’\-][^\W\d_]+)*[ \t]+){2,6}"
    r"(?:llc|llp|plc|ltd\.?|limited|corp\.?|corporation|inc\.?|incorporated)",
    re.I,
)
_RECEIPT_PRIVATE_RELATION = re.compile(
    r"\b(?:(?:i|we) (?:work(?:ed)? (?:here|there|for them)|"
    r"(?:am|are|was|were) (?:paid by|employed (?:by|here|there)))|"
    r"where (?:i|we) work|(?:on (?:their|the) payroll)|"
    r"(?:my|our) (?:employer|workplace|payroll|paycheck|paycheque|payslip|(?:own )?(?:company|business)))\b",
    re.I,
)
_SCHOOL_IDIOM = re.compile(r"(?:the )?school of thought\Z", re.I)
_MENU_ITEM = re.compile(
    r"\b(?:menu label (?:was|is)|app called it)\s+[“'\"]*"
    r"(?P<item>(?:[^\W\d_]+\s+){1,4}?(?:plate|platter|bento|special|sandwich|salad|bowl))\b", re.I,
)
_CLAUSE_BOUNDARY = re.compile(r"[.!?;:]|\b(?:and then|but then|afterwards)\b", re.I)


def is_product_title(text, hit, explicit_identities):
    if hit.label not in _IDENTITY_LABELS:
        return False
    prefix = text[max(0, hit.start - 64):hit.start]
    suffix = text[hit.end:hit.end + 58]
    if _PRIVATE_ROLE.search(prefix) or any(
        identity.start < hit.end and hit.start < identity.end for identity in explicit_identities
    ):
        return False
    return bool(_TITLE_PREFIX.search(prefix) or _TITLE_SUFFIX.match(suffix))


def is_explicit_commercial_reference(text, hit, private_hits):
    """Exclude contextual identity guesses for named products and generic roles."""
    if hit.label not in _IDENTITY_LABELS or any(
        other.start < hit.end and hit.start < other.end for other in private_hits
    ):
        return False
    before = _CLAUSE_BOUNDARY.split(text[max(0, hit.start - 90):hit.start])[-1]
    after = _CLAUSE_BOUNDARY.split(text[hit.end:hit.end + 88])[0]
    if _PRIVATE_ASSERTION.search(before) or _PRIVATE_ASSERTION.search(after):
        return False
    if _COMMERCIAL_LABEL.match(after) or (_DEMO.search(before) and _SAMPLE_WORKPLACE.match(after)):
        return True
    value = text[hit.start:hit.end]
    if _SCHOOL_IDIOM.fullmatch(value) or (
        _GENERIC_MENTION.fullmatch(value) and (" " in value or _DETERMINER.search(before))
    ):
        return True
    return any(
        item.start("item") <= len(before) and len(before) + len(value) <= item.end("item")
        for item in _MENU_ITEM.finditer(before + value + after)
    )


def is_generic_occupation_reference(text, hit, private_hits):
    if hit.label.casefold() not in {"person", "name"} or any(
        private.start < hit.end and hit.start < private.end for private in private_hits
    ):
        return False
    phrase = text[hit.start:hit.end]
    if not _OCCUPATION.fullmatch(phrase) or not phrase.split()[-1].islower():
        return False
    before = _CLAUSE_BOUNDARY.split(text[max(0, hit.start - 90):hit.start])[-1]
    if _PRIVATE_ROLE.search(before) or _PRIVATE_ASSERTION.search(before):
        return False
    return bool(re.search(r"\s", phrase) or _OCCUPATION_PREFIX.search(before))


def public_organization_ranges(text):
    for match in _PUBLIC_ORGANIZATION.finditer(text):
        before = _CLAUSE_BOUNDARY.split(text[max(0, match.start() - 90):match.start()])[-1]
        if _PRIVATE_ROLE.search(before) or _PRIVATE_ASSERTION.search(before):
            continue
        if _LEGAL_ORGANIZATION.search(match[match.lastgroup]):
            yield match.span(match.lastgroup)
    for match in _RECEIPT_SELLER.finditer(text):
        seller = match["seller"]
        if not _SELLER_COMPANY.fullmatch(seller):
            continue
        before = _CLAUSE_BOUNDARY.split(text[max(0, match.start() - 90):match.start()])[-1]
        continuation = text[match.end():match.end() + 90].lstrip(" \t.!?")
        after = _CLAUSE_BOUNDARY.split(continuation)[0]
        if not _RECEIPT_PRIVATE_RELATION.search(after) and not any(
            pattern.search(fragment)
            for pattern in (_PRIVATE_ROLE, _PRIVATE_ASSERTION, _RECEIPT_PRIVATE_RELATION)
            for fragment in (before, seller)
        ):
            yield match.span("seller")


def is_public_organization_reference(hit, ranges, private_hits):
    return (hit.label.casefold() in _ORGANIZATION_LABELS
            and any(start <= hit.start and hit.end <= end for start, end in ranges)
            and not any(item.start < hit.end and hit.start < item.end for item in private_hits))
