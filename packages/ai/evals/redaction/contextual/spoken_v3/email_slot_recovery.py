"""Find explicit spoken emails with a damaged or fragmented separator."""

import re

from candidate import Hit
from spoken_contact import tokenize
from spoken_contacts_recover import _DOMAIN_BREAK, _HANDLE_BREAK, _TLDS, _WEAK_AT, _WEAK_MAIL_BREAK, _WEB_ACTION, _phone_runs


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
_PROSE_SUFFIX = {"an", "and", "are", "but", "for", "is", "of", "or", "that", "the", "those",
                 "to", "was", "were", "when", "who", "with", "your", "you"}
_BLOCK = {"a", "an", "the", "my", "myself", "theirs", "as", "it", "for", "at", "to"}
_RECEIPT = re.compile(r"\b(?:the|my|our) (?:receipt|confirmation) (?:goes|went) to\s+")
_ADDRESS_LABEL = re.compile(
    r"\b(?:e-?mail(?: address)? (?:field (?:please )?(?:enter|use|type)|"
    r"(?:(?:i|we|you) (?:gave(?: them| you)?|provided(?: them| you)?|verified|confirmed) )?(?:is|was))|"
    r"(?:send|direct) (?:the|my|our) (?:survey )?(?:reply|receipt) to (?:the|my|our) "
    r"(?:verified |confirmed )?(?:private |personal )?e-?mail(?: address)?)\s*(?::\s*|\s+)"
)
_CONFIRMATION = re.compile(r"^\s+for (?:the|my|our) (?:order |booking |delivery )?confirmation\b")
_PUBLIC_REFERENCE = re.compile(r"\b(?:public (?:page|site|link|guide)|product (?:label|name)|vendor site)\b")
_PUBLIC_SUFFIX = re.compile(r"^\s+(?:as|for|on) (?:the |a |this )?(?:public |product |vendor )?(?:website|site|page|catalog|menu)\b")
_NON_MAIL_VALUE = re.compile(
    r"^(?:about (?:the|a|this|that)\b|(?:open|down|closed)\s+(?:and|while|until)\b)|"
    r"\b(?:but|while|because) (?:i|we|they|you)\b"
)
_PRIVATE_LABEL = re.compile(
    r"\b(?:(?:e-?mail(?: address)?|inbox|mailbox)(?: (?:is|was|as))?\s*:\s*|"
    r"(?:e-?mail(?: address)?|inbox|mailbox) (?:is|was|as)\s+|(?:write|email) me (?:to|at)\s+|"
    r"(?:for e-?mail (?:use|try)|(?:the )?written reply (?:goes to|use))\s+)"
)
_SPLIT_ADDRESS_ROLE = re.compile(
    r"\b(?:e-?mail address (?:(?:i|we|you) (?:gave|provided|verified|confirmed) )?(?:is|was)|"
    r"(?:write|e-?mail) me (?:to|at)|for e-?mail (?:use|try)|(?:reply|respond) by e-?mail (?:to|at))"
    r"\s*(?::\s*|\s+)"
)
_CONFIRMED_AT = _STRONG_AT | {"ad", "add", "an", "and", "et", "said", "set", "at's"}
_AT_PAIRS = {("as", "an"), ("at", "sign")}
_CONFIRMED_DOT = _DOMAIN_BREAK | _DISTORTED_DOT | {"dott", "drug"}
_HOST_WORD = re.compile(r"[^\W\d_]{2,}(?:-[^\W\d_]{2,})*\Z")
_PRIVATE_SUFFIXES = _TLDS | {"example"}
_FUSED_AT = re.compile(r"[^\W\d_]{2,}at[^\W\d_]{3,}\Z")
_DISCOURSE_WORDS = _BLOCK | {"and", "but", "because", "if", "i", "we", "they", "while"}
_SPLIT_PROSE = _DISCOURSE_WORDS | _WEB_ACTION | {"available", "closed", "down", "empty", "full", "open"}


def _domain_continues(tokens, stop):
    if stop + 1 >= len(tokens):
        return False
    separator, following = tokens[stop:stop + 2]
    if separator.word == ".":
        return tokens[stop - 1].end == separator.start and separator.end == following.start and following.word.isalnum()
    return (
        separator.word in _DOMAIN_BREAK and following.word.isalpha() and following.word not in _PROSE_SUFFIX
    )


def _domain_suffix(text, tokens, separator, *, suffixes=_TLDS, inferred_limit=0):
    start = separator + 1
    if start >= len(tokens):
        return None
    first = tokens[start].word
    for size in (2, 3, 4):
        stop = start + size
        pieces = [part.word for part in tokens[start:stop]]
        if len(pieces) != size or not all(part.isalpha() for part in pieces):
            continue
        if first in suffixes and any(len(part) != 1 for part in pieces[1:]):
            continue
        joined = "".join(pieces)
        if joined in suffixes and not _domain_continues(tokens, stop):
            return stop
    if _domain_continues(tokens, start + 1):
        return None
    if first in suffixes:
        return start + 1
    if first.isalpha() and 2 <= len(first) <= inferred_limit and first not in _PROSE_SUFFIX:
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
    if _public_mail_reference(lower[start:host.end], tail):
        return None
    return Hit("email", start, host.end)


def recover_email_slots(text):
    tokens = tokenize(text)
    lower = _offset_preserving_lower(text)
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
        end = _domain_suffix(lower, tokens, index, inferred_limit=7 if strong_start else 0)
        if end is not None:
            first, last = tokens[start].start, tokens[end - 1].end
            if not _public_mail_reference(lower[first:last], lower[last:]):
                yield Hit("email", first, last)


def _public_mail_reference(value, following):
    return "@" not in value and (
        _NON_MAIL_VALUE.search(value) or _PUBLIC_REFERENCE.search(value) or _PUBLIC_SUFFIX.match(following)
    )


def _offset_preserving_lower(text):
    folded = text.casefold()
    if len(folded) == len(text):
        return folded
    return "".join(part if len(part) == 1 else original for original, part in zip(text, map(str.casefold, text)))


def _handle_atom(word):
    return word.isalnum() and word not in _DISCOURSE_WORDS and word not in _HANDLE_BREAK


def _spelled_handle(handle):
    return (
        1 <= len(handle) <= 8 and _handle_atom(handle[0].word) and _handle_atom(handle[-1].word)
        and all(
            _handle_atom(token.word)
            or index > 0 and token.word in _HANDLE_BREAK and _handle_atom(handle[index - 1].word)
            for index, token in enumerate(handle)
        )
    )


def _labeled_address_shape(tokens, first, separator):
    host = separator - 1
    while host >= first and _HOST_WORD.fullmatch(tokens[host].word):
        marker = host - 1
        if marker > first and tokens[marker].word == "sign" and tokens[marker - 1].word == "at":
            marker -= 1
        if marker > first and tokens[marker].word in _STRONG_AT and _spelled_handle(tokens[first:marker]):
            return True
        if _FUSED_AT.fullmatch(tokens[host].word) and _spelled_handle(tokens[first:host + 1]):
            return True
        if host - first >= 2 and _spelled_handle(tokens[first:host]):
            return True
        if host - first < 2 or tokens[host - 1].word not in _DOMAIN_BREAK:
            return False
        host -= 2
    return False


def _split_host_address(text, words):
    if len(words) not in (5, 6):
        return False
    handle, marker, host = words[:2], words[2:-2], words[-2:]
    return (
        tuple(token.word for token in marker) in {("at",), ("at", "sign")}
        and _spelled_handle(handle)
        and all(token.word not in _SPLIT_PROSE for token in (*handle, *host))
        and all(_HOST_WORD.fullmatch(token.word) for token in host)
        and all(text[left.end:right.start].isspace() for left, right in zip(words, words[1:]))
    )


def _recover_labeled_spelling(lower, tokens, offsets):
    """Read a mailbox after a direct label, including fused or missing spoken separators."""
    starts = {label.end() for pattern in (_PRIVATE_LABEL, _ADDRESS_LABEL) for label in pattern.finditer(lower)}
    split_starts = {label.end() for label in _SPLIT_ADDRESS_ROLE.finditer(lower)}
    for start in sorted(starts | split_starts):
        first = offsets.get(start)
        if first is None:
            continue
        for separator in range(first + 1, min(first + 15, len(tokens))):
            if tokens[separator].word not in _DOMAIN_BREAK:
                continue
            stop = _domain_suffix(lower, tokens, separator, suffixes=_PRIVATE_SUFFIXES, inferred_limit=63)
            if stop is None:
                continue
            if not (
                start in starts and _labeled_address_shape(tokens, first, separator)
                or start in split_starts and _split_host_address(lower, tokens[first:separator])
            ):
                continue
            end = tokens[stop - 1].end
            if not _public_mail_reference(lower[start:end], lower[end:]):
                yield Hit("email", start, end)


def _domain_endings(lower, tokens):
    for index, token in enumerate(tokens):
        word = token.word
        if word.startswith("dot") and word[3:] in _TLDS:
            yield index, index + 1, False
        elif word.isalpha() and any(len(tld) >= 3 and len(word) >= len(tld) + 3 and word.endswith(tld)
                                    for tld in _TLDS | {"example"}):
            yield index + 1, index + 1, True
        if word not in _CONFIRMED_DOT:
            continue
        right = index + 1
        end = _domain_suffix(lower, tokens, index)
        if end is not None:
            yield index, end, False
        elif tuple(item.word for item in tokens[right:right + 2]) == ("and", "valid"):
            yield index, right + 2, False


def _handle_endings(tokens, host_end):
    for host_length in (1, 2):
        marker = host_end - host_length - 1
        if marker < 1:
            continue
        host = tokens[marker + 1:host_end]
        if not all(_HOST_WORD.fullmatch(item.word) and item.word not in _BLOCK for item in host):
            continue
        if marker > 1 and (tokens[marker - 1].word, tokens[marker].word) in _AT_PAIRS:
            yield marker - 1
        elif tokens[marker].word in _CONFIRMED_AT:
            yield marker


def recover_corroborated_mailboxes(text):
    """Combine damaged address structure with an explicit or corroborated contact value."""
    lower = _offset_preserving_lower(text)
    tokens = tokenize(text)
    phones = tuple(_phone_runs(text, tokens))
    offsets = {token.start: index for index, token in enumerate(tokens)}
    yield from _recover_labeled_spelling(lower, tokens, offsets)
    for host_end, stop, fused_host in _domain_endings(lower, tokens):
        end = tokens[stop - 1].end
        following = lower[end:end + 100]
        for handle_end in _handle_endings(tokens, host_end):
            boundary = tokens[handle_end].start
            before = max(0, boundary - 140)
            context = lower[before:boundary]
            labels = tuple(match for pattern in (_MAIL_CUE, _RECEIPT, _ADDRESS_LABEL) for match in pattern.finditer(context))
            assignments = tuple(_ASSIGNMENT.finditer(context))
            anchors = labels or assignments
            if not anchors:
                continue
            cue = max(anchors, key=lambda match: match.end())
            start = before + cue.end()
            first = offsets.get(start, handle_end)
            if not 1 <= handle_end - first <= (8 if labels else 6):
                continue
            value = lower[start:end]
            if _WEBSITE.search(value) or _public_mail_reference(value, following):
                continue
            handle = tokens[first:handle_end]
            if not all(item.word.isalnum() or item.word in _HANDLE_BREAK for item in handle):
                continue
            if fused_host and (not labels or tokens[handle_end].word not in _STRONG_AT):
                continue
            if not labels:
                if following.strip() and not _NEW_CLAUSE.search(following):
                    continue
                before_phone = any(0 <= before + cue.start() - phone.end <= 28 for phone in phones)
                after_phone = _CONFIRMATION.match(following) and any(0 <= phone.start - end <= 95 for phone in phones)
                if handle[0].word in _BLOCK or not (before_phone or after_phone):
                    continue
            yield Hit("email", start, end)
