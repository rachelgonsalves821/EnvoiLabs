"""Keep explicit public website references out of contextual identity masks."""

import re

from email_slot_recovery import _DISTORTED_DOT
from spoken_contact import tokenize
from spoken_contacts_recover import _DOMAIN_BREAK, _TLDS


_IDENTITY = {"person", "name", "organization", "ORGANIZATION", "organization educational"}
_LOCATOR_LABELS = _IDENTITY | {"email", "email address", "EMAIL_ADDRESS"}
_HOST = re.compile(r"[^\W_]+(?:-[^\W_]+)*\Z")
_WEBSITE = re.compile(
    r"\b(?:website|web site|public guide|public page|public url|catalog site|public domain|"
    r"browser|site address|landing page|(?:public|official|vendor) (?:menu|catalog(?:ue)?|site))\b",
    re.I,
)
_PUBLIC_AT = re.compile(
    r"\b(?:public|official|vendor) (?:website|web site|site|page|menu|catalog(?:ue)?|guide)\s+at\s*$", re.I,
)
_SITE_SUFFIX = re.compile(r"^\s+(?:(?:for|as|on) (?:a |the )?)?(?:website|web site|public site|site link|public link)\b", re.I)
_ROLE = re.compile(
    r"\b(?:(?:my|our|their|the) (?:employer|workplace|school|company|university|personal (?:site|website))|"
    r"(?:i|we) (?:work(?:ed)?|study|studied) (?:at|for)|"
    r"name on (?:my|our)|(?:driver|courier|manager) (?:is|was) named|"
    r"(?:e-?mail|mailbox|inbox)(?: address)? (?:is|was|uses) (?!about\b)|"
    r"(?:write|email) me (?:at|on)|(?:for|by) email to)\b",
    re.I,
)
_BOUNDARY = re.compile(r"[!?;]|\.(?=\s)|\b(?:and then|but then|while|afterwards)\b", re.I)
_SHORT_ACTION = re.compile(r"^\s*(?:add|enter|open|visit|view|type|click)\s*$", re.I)
_PRODUCT_LABEL = re.compile(
    r"\b(?:(?:product|catalog|demo|menu) (?:name|label|variant) (?:is|was|reads|says)|"
    r"product called|website caption listed)\s+[\s'\"“]*$", re.I,
)


def _anchors(text, start, end):
    before = _BOUNDARY.split(text[max(0, start - 66):start])[-1]
    after = _BOUNDARY.split(text[end:end + 38])[0]
    if _ROLE.search(before) or before.rstrip().endswith("@"):
        return False
    return bool(_WEBSITE.search(before) or _SITE_SUFFIX.match(after))


def public_website_ranges(text):
    tokens = tokenize(text)
    for separator in range(1, len(tokens) - 1):
        token = tokens[separator]
        if token.word not in _DOMAIN_BREAK and token.word not in _DISTORTED_DOT:
            continue
        first = separator - 1
        if not _HOST.fullmatch(tokens[first].word):
            continue
        for count in (4, 3, 2, 1):
            suffix = tokens[separator + 1:separator + 1 + count]
            if len(suffix) != count or "".join(part.word for part in suffix) not in _TLDS:
                continue
            if _anchors(text, tokens[first].start, suffix[-1].end):
                yield tokens[first].start, suffix[-1].end
            break
    for word in tokens:
        if not word.word.isalpha() or not _SITE_SUFFIX.match(text[word.end:word.end + 38]):
            continue
        if any(
            len(tld) >= 3 and len(word.word) >= len(tld) + 3 and word.word.endswith(tld)
            for tld in _TLDS
        ) and _anchors(text, word.start, word.end):
            yield word.start, word.end


def explicit_spoken_locator_ranges(text, site_ranges):
    for start, end in site_ranges:
        left = max(0, start - 66)
        prefix = text[left:start]
        match = _PUBLIC_AT.search(prefix)
        if match and not _ROLE.search(_BOUNDARY.split(prefix)[-1]) and "@" not in text[start:end]:
            yield left + match.start(), end


def inside_public_locator(hit, ranges, explicit_identities):
    return (
        hit.label in _LOCATOR_LABELS
        and not any(item.start < hit.end and hit.start < item.end for item in explicit_identities)
        and any(start <= hit.start and hit.end <= end for start, end in ranges)
    )


def preserving_public_ref(text, hit, explicit_identities, site_ranges):
    if hit.label not in _IDENTITY or any(
        item.start < hit.end and hit.start < item.end for item in explicit_identities
    ):
        return False
    before = _BOUNDARY.split(text[max(0, hit.start - 66):hit.start])[-1]
    if _ROLE.search(before):
        return False
    if _PRODUCT_LABEL.search(before):
        return True
    for start, end in site_ranges:
        if hit.end <= start or hit.start >= end or hit.end > end:
            continue
        if hit.start >= start or _SHORT_ACTION.match(text[hit.start:start]):
            return True
    return False
