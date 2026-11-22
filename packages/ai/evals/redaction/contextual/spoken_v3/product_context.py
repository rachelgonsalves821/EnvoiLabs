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
