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
    r"say the emails?(?: slowly)?|(?:i|we) spell it|mailing list (?:uses|used)|says|said|"
    r"(?:i|we) (?:put|used|entered|gave|typed|wrote|use)|(?:write|send|mail) (?:it |a copy )?to|"
    r"have it sent(?: to)?|and then|now use|(?:it's|it is)|use|to|as)(?:\s*:\s*|\s+)", re.I,
)
_HANDLE_ACTION = re.compile(r"\b(?:try|i (?:(?:don't|don’t) )?(?:check|read))\s+", re.I)
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
_DNS_SUFFIX = re.compile(r"[a-z]{2,20}\Z")
_DOMAIN_WORD = re.compile(r"[a-z](?:[a-z0-9-]*[a-z0-9])?\Z")
_MAILBOX_END = re.compile(r"\s*(?:$|[,.;:!?]|(?:and|but|then|before|after) (?:i|we|they|you|it)\b)", re.I)
_MAILBOX_PURPOSE = re.compile(
    r"\s+for (?:the|my|our|your) (?:(?:booking|delivery|order|survey|written) )?(?:reply|confirmation)"
    r"(?=\s*(?:$|[,.;:!?])|\s+(?:after|and|before|but|email|then)\b)", re.I,
)
_PURPOSE_PROSE = _HANDLE_START_BLOCK | {"after", "before", "but", "while"}
_PHONE_JOIN = re.compile(
    r"(?:[\s,;:]*(?:and|or|then|also|phone|number|is|mobile|cell|call|text|me|my|at)\b){0,5}[\s,;:]*",
    re.I,
)
_NAVIGATION_PREFIX = re.compile(
    r"\b(?:browse|click|go|look|navigate|open|read|shop|view|visit) (?:to |at |on )?\s*\Z",
    re.I,
)
_PUBLIC_MAILBOX_PREFIX = re.compile(
    r"\b(?:(?:(?:public|official|vendor|store|support) )?(?:web ?site|page|url|catalog|public link)"
    r"(?:\s+(?:at|is|was|says|shows?|reads|uses|lists?))?|"
    r"(?:looked|shopped) at|(?:went|navigated) to|(?:browsed|clicked|opened|visited)(?: on)?)"
    r"[\s,:]*\Z", re.I,
)


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


def _structured_handle_start(tokens, handle_end, *, sentence_bound=False):
    """Read adjacent written or spoken local-part separators without taking preceding prose."""
    last = handle_end - 1
    if not _WORD.fullmatch(tokens[last].word) or tokens[last].word in _WEB_ACTION:
        return None
    first = last
    while first >= 2 and last - first < 6 and tokens[first - 1].word in _HANDLE_BREAK:
        separator = tokens[first - 1]
        if sentence_bound and separator.word == "." and separator.end != tokens[first].start:
            break
        atom = tokens[first - 2].word
        if not _WORD.fullmatch(atom) or atom in _HANDLE_START_BLOCK or atom in _WEB_ACTION:
            break
        first -= 2
    return first if first < last else None


def _followed_by_phone(text, end, phones):
    return any(0 <= phone.start - end <= 36 and _PHONE_JOIN.fullmatch(text[end:phone.start]) for phone in phones)


def _split_host_handle_start(text, tokens, last_host, *, sentence_bound=False):
    marker = last_host - 2
    if marker < 1 or tokens[marker].word != "at":
        return None
    left, right = tokens[last_host - 1:last_host + 1]
    if not text[left.end:right.start].isspace() or any(
        not _DOMAIN_WORD.fullmatch(atom.word) or atom.word in _HANDLE_START_BLOCK or atom.word in _WEB_ACTION
        for atom in (left, right)
    ):
        return None
    return _structured_handle_start(tokens, marker, sentence_bound=sentence_bound)


def _public_mailbox_context(text, start, purpose_end):
    return _NAVIGATION_PREFIX.search(text[max(0, start - 40):start]) or (
        purpose_end and _PUBLIC_MAILBOX_PREFIX.search(text[max(0, start - 64):start])
    )


def _email_runs(text, tokens, phones):
    for tld in range(3, len(tokens)):
        context = text[max(0, tokens[tld].start - 100):tokens[tld].end + 45]
        intent = bool(_EMAIL_INTENT.search(context))
        ending = tokens[tld].word
        end = tokens[tld].end
        purpose_end = ending not in _PURPOSE_PROSE and bool(_MAILBOX_PURPOSE.match(text, end))
        bounded_end = bool(_DNS_SUFFIX.fullmatch(ending) and (
            _MAILBOX_END.match(text[end:]) or purpose_end or _followed_by_phone(text, end, phones)
        ))
        unlisted = ending not in _TLDS and bounded_end
        fused = intent and ending.startswith("dot") and ending[3:] in _TLDS
        if fused:
            domain = tld - 1
        else:
            if ending not in _TLDS and not unlisted:
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
        if not fused and bounded_end and sep in _DOMAIN_BREAK:
            first = _split_host_handle_start(text, tokens, domain, sentence_bound=purpose_end)
            if first is not None:
                start = tokens[first].start
                if not _public_mailbox_context(text, start, purpose_end):
                    yield Hit("email", start, end)
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
        if unlisted and not fused:
            first = (_structured_handle_start(tokens, handle_end, sentence_bound=purpose_end)
                     if strict and sep in _DOMAIN_BREAK else None)
            if first is not None:
                start = tokens[first].start
                if not _public_mailbox_context(text, start, purpose_end):
                    yield Hit("email", start, end)
            continue
        left_limit = 12 if strict else 8
        left_first = max(0, handle_end - left_limit)
        left = text[tokens[left_first].start:tokens[handle_end - 1].end]
        cue = tuple(_LOCAL_START.finditer(left))
        if cue:
            lower = tokens[left_first].start + cue[-1].end()
            first = next((i for i in range(left_first, handle_end) if tokens[i].start >= lower), handle_end)
        else:
            action = tuple(_HANDLE_ACTION.finditer(left))
            if strict and action:
                lower = tokens[left_first].start + action[-1].end()
                first = next((i for i in range(left_first, handle_end) if tokens[i].start >= lower), handle_end)
                tail = tokens[first + 1:handle_end]
                if not tail or not all(
                    token.word.isalnum() and (len(token.word) == 1 or token.word.isdigit() or token.word in _NATIVE)
                    for token in tail
                ):
                    continue
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
    phones = tuple(_phone_runs(text, tokens))
    yield from phones
    yield from _email_runs(text, tokens, phones)
