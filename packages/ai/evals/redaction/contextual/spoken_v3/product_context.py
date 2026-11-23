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
