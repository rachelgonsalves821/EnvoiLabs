"""Find explicit spoken emails with a damaged or fragmented separator."""

import re

from candidate import Hit
from spoken_contact import tokenize
from spoken_contacts_recover import _DOMAIN_BREAK, _HANDLE_BREAK, _TLDS, _WEAK_AT, _WEAK_MAIL_BREAK, _WEB_ACTION


_MAIL_CUE = re.compile(
    r"\b(?:e-?mail(?: address)? (?:is|was|as)|(?:my |their |the )?inbox (?:is|was|as)|"
    r"the (?:written reply|mailing list) (?:uses|goes to)|for (?:email|the written reply) (?:use|try)|"
    r"(?:the )?written reply use|say (?:the |my )?emails?(?: slowly)?|(?:i|we) spell it|"
    r"(?:in writing|for email) (?:it[’']s|it is)|sent? the (?:receipt|reply) to|"
    r"(?:my|our) (?:reply|email) (?:goes|went) to|"
    r"(?:write|email) (?:me )?(?:to|at)|send (?:my|the|a) (?:receipt|reply) by email to)\s*(?::\s*|\s+)",
)
_ASSIGNMENT = re.compile(
    r"\b(?:(?:i|we) (?:used|use|put|entered|checked|check|typed|wrote|remembered)|"
    r"the receipt goes to|(?:actually |please )?put|try|and then (?:remembered|used)|"
    r"(?:i )?(?:don't |don’t )?read|as my mobile and|it's|"
    r"send (?:the|my|a) (?:receipt|reply|follow[ -]up) to)\s+",
)
_NEW_CLAUSE = re.compile(
    r"^\s*(?:[.!?,;:]|after\b|because\b|for (?:the|a|my|our)\b|until\b|before\b|"
    r"on (?:the|my) (?:receipt|delivery)|you already\b|now\b|then\b|today\b|"
    r"(?:i|we|they|you) (?:usually|always|will|also|should|added|needed)\b)"
)
_STRONG_AT = {"at", "@"}
_DISTORTED_DOT = {*_WEAK_MAIL_BREAK, "dat", "daught"}
_WEBSITE = re.compile(
    r"\b(?:browse|click|go to|visit|look at|shop at|check out)\b|"
    r"\b(?:the |a )?(?:website|web site|homepage|menu|product|url)\b"
)
_BOUNDARY = {"and", "that", "to", "when", "who", "your", "you"}
_BLOCK = {"a", "an", "the", "my", "myself", "theirs", "as", "it", "for", "at", "to"}


def _domain_suffix(text, tokens, separator, strong_start):
    start = separator + 1
    if start >= len(tokens):
        return None
    first = tokens[start].word
    if first in _TLDS:
        return start + 1
    for size in (2, 3, 4):
        stop = start + size
        pieces = [part.word for part in tokens[start:stop]]
        if len(pieces) != size or not all(part.isalpha() for part in pieces):
            continue
        joined = "".join(pieces)
        if joined in _TLDS:
            return stop
    if strong_start and first.isalpha() and 2 <= len(first) <= 7 and first not in _BOUNDARY:
        suffix = text[tokens[start].end:]
        if not suffix.strip() or _NEW_CLAUSE.search(suffix):
            return start + 1
    return None


def _recover_fused_host(lower, tokens, domain):
    host = tokens[domain]
    at = domain - 1
    if not host.word.isalpha() or tokens[at].word not in _STRONG_AT:
        return None
    if not any(len(tld) >= 3 and len(host.word) >= len(tld) + 3 and host.word.endswith(tld) for tld in _TLDS):
        return None
    tail = lower[host.end:]
    if tail.strip() and not _NEW_CLAUSE.search(tail) and not re.match(r"^\s*and\s+\w+", tail):
        return None
    before_start = tokens[max(0, at - 13)].start
    before = lower[before_start:tokens[at].start]
    cues = tuple(_MAIL_CUE.finditer(before))
    if not cues:
        return None
    start = before_start + cues[-1].end()
    handle = [token for token in tokens[max(0, at - 7):at] if token.start >= start]
    if not handle or handle[0].start != start or _WEBSITE.search(lower[start:tokens[at].start]):
        return None
    if any(not token.word.isalnum() and token.word not in _HANDLE_BREAK for token in handle):
        return None
    return Hit("email", start, host.end)


def recover_email_slots(text):
    tokens = tokenize(text)
    lower = text.casefold()
    if len(lower) != len(text):
        return
    for index in range(3, len(tokens)):
        separator = tokens[index]
        fused = _recover_fused_host(lower, tokens, index)
        if fused is not None:
            yield fused
        if separator.word not in _DOMAIN_BREAK and separator.word not in _DISTORTED_DOT:
            continue
        domain = index - 1
        while domain >= 3 and tokens[domain - 1].word in _DOMAIN_BREAK and index - domain < 6:
            domain -= 2
        if not tokens[domain].word.isalpha() or domain < 1:
            continue
        at = domain - 1
        exact_at = tokens[at].word in _STRONG_AT or tokens[at].word == "sign" and tokens[at - 1].word == "at"
        weak_at = tokens[at].word in _WEAK_AT or tokens[at].word in {"et", "at's"}
        handle_end = at if exact_at or weak_at else domain
        if exact_at and tokens[at].word == "sign":
            handle_end -= 1
        if handle_end < 1:
            continue
        left = max(0, handle_end - 13)
        before = lower[tokens[left].start:tokens[handle_end - 1].end]
        cue = tuple(_MAIL_CUE.finditer(before))
        assign = tuple(_ASSIGNMENT.finditer(before))
        anchors = cue or assign
        if not anchors:
            continue
        offset = tokens[left].start + anchors[-1].end()
        start = next((i for i in range(left, handle_end) if tokens[i].start >= offset), handle_end)
        if start == handle_end or not 1 <= handle_end - start <= (7 if cue else 5):
            continue
        handle = tokens[start:handle_end]
        operators = any(token.word in _HANDLE_BREAK for token in handle)
        if not cue and (_WEBSITE.search(before) or handle[0].word in _BLOCK or handle[-1].word in _WEB_ACTION):
            continue
        if any(not token.word.isalnum() and token.word not in _HANDLE_BREAK for token in handle):
            continue
        if not (exact_at or cue or weak_at and operators):
            continue
        if not exact_at and not weak_at and not operators and len(handle) > 4:
            continue
        strong_start = exact_at and (bool(cue) or bool(assign)) and (operators or len(handle) >= 2)
        if separator.word not in _DOMAIN_BREAK and not (strong_start or cue or weak_at and operators):
            continue
        end = _domain_suffix(lower, tokens, index, strong_start)
        if end is not None:
            yield Hit("email", tokens[start].start, tokens[end - 1].end)
