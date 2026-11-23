"""Find a person value bounded by an explicit record and a name confirmation."""

import re

from candidate import Hit


_RECORD = re.compile(
    r"\b(?:(?:put|listed|booked|filed|saved|registered|reserved|wrote|signed)"
    r"(?: (?:it|the order|the receipt|the form|the booking|the pickup))? (?:under|as)|"
    r"(?:they|the clerk|the manager|the organizer) (?:wrote down|entered|typed)|"
    r"(?:the|my) (?:order|receipt|record|account|reservation) (?:is|was) under)\s+",
    re.I,
)
_CONFIRMATION = re.compile(
    r"[,\s]*(?:(?:which|and that) (?:is|was) (?:my|their|his|her) (?:full |legal |actual |real )?name|"
    r"that[’']s (?:my|their|his|her) (?:full |legal |actual |real )?name|"
    r"(?:on|in) (?:the|my) (?:full |legal )?name (?:field|line|box))\b",
    re.I,
)
_DIRECT = re.compile(
    r"\b(?:(?:the|my|our) name (?:on|in) (?:the|my|our) (?:account|order|receipt|badge|booking) "
    r"(?:is|was)|(?:my|his|her|their) (?:full |legal |badge |preferred )?name (?:is|was|should be)|"
    r"(?:the )?(?:person (?:collecting|picking up) (?:the|my) (?:order|pickup)|pickup contact) (?:is|was)|"
    r"(?:under|as) my (?:full |legal )?name)(?:\s*:\s*|\s+)",
    re.I,
)
_PAIRED_FIELDS = (
    (
        re.compile(
            r"\b(?:i (?:do not|don't|don’t) go by|i go by|my) (?:the )?"
            r"(?:full|shortened|preferred|legal|registered|different) name\b[^.,?!;]{0,30}?\b(?:use|enter|write)\s+",
            re.I,
        ),
        re.compile(r"\s+(?:and )?(?:my|their) (?:employer|workplace) (?:is|was)\b", re.I),
    ),
    (
        re.compile(r"\b(?:my|their|his|her) (?:badge|tag|display|id) name\s*[, :]?\s+", re.I),
        re.compile(r"\s+(?:on|in) (?:the|my|their) (?:card|badge|tag|profile)\b", re.I),
    ),
    (
        re.compile(
            r"\b(?:the|my) (?:workshop|training|attendance|session) (?:list|lists|roster) (?:says|shows|lists)\s+",
            re.I,
        ),
        re.compile(r"\s+(?:and )?(?:that )?(?:my|their) (?:employer|workplace) (?:is|was)\b", re.I),
    ),
)
_STOP = re.compile(
    r"[.!?;,:]|\b(?:which|after|before|because|when|so that|instead|"
    r"(?:an|and|the) employee of|(?:my|their|his|her) (?:employer|workplace) (?:is|was)|"
    r"put\b(?=.{2,48}\bin the workplace field)|"
    r"(?:and|then|but) (?:i|we|you|they|it|the)|"
    r"(?:i|we|you|they) (?:used|entered|changed|was|were|picked|paid|submitted))\b",
    re.I,
)
_WORD = re.compile(r"[^\W\d_]+(?:[’'-][^\W\d_]+)*")
_CONTEXT_WORDS = re.compile(
    r"\b(?:label|product|password|order number|tracking number|website|promo code|"
    r"screen name|under the|at the|it is|name is|it was|their names|my name|what i)\b",
    re.I,
)
_CARD_NAME = re.compile(
    r"\b(?:my|their|his|her|our) (?:(?:staff |work )?(?:badge|card)|bad|name tag) name\s+",
    re.I,
)
_ON_CARD = re.compile(r"\s+(?:on|in) (?:the|my|their|his|her) (?:staff |work )?(?:card|badge|tag)\b", re.I)
_RECEIPT_VALUE = re.compile(r"\b(?:the |my )?order (?:receipt|recede) (?:uses|lists|shows|says)\s+", re.I)
_PERSON_RECORD = re.compile(
    r"\b(?:(?:receipt|check[ -]?in|registration|pickup|order) (?:recipient|collector|attendee|participant|guest)(?: name)?|"
    r"(?:pickup|registration|check[ -]?in) (?:person|attendee) name|"
    r"(?:named|registered) (?:recipient|collector|attendee)|"
    r"the name (?:in|on) (?:the|my) (?:recipient|collector|registration|check[ -]?in) (?:box|field|line))(?: (?:is|was)|\s*:)\s+|"
    r"\bi signed (?:in with )?my (?:full |legal )?name\s+",
    re.I,
)
_RECORD_END = re.compile(
    r"[.,!?;:]|\b(?:and|but|then|so) (?:i|we|they|the|it)|\b(?:because|when|before|after|until)|"
    r"\bthat[’']?s (?:what i|my name|me)\b|"
    r"(?P<nonperson>\b(?:as|for) (?:the|a) (?:item|product|account|business|vendor|public|signature|check[ -]?in time)\b)",
    re.I,
)
_PUBLIC_RECORD = re.compile(
    r"\b(?:item name|product name|account id|public (?:store|business|supplier)|signature status|"
    r"check[ -]?in time|arrival time|pickup slot|shift notes?|approved by|they them)\b",
    re.I,
)
_FIELD_RECORD = re.compile(
    r"\b(?:my (?:(?:work|workplace|staff|employee) )?(?:card|badge)|"
    r"the badge (?:clipped|attached) to my (?:lanyard|shirt|card)|"
    r"the (?:old |new )?(?:employee|staff) card|(?:the |my )?(?:order )?receipt) (?:uses|shows|says|lists|has)\s+",
    re.I,
)
_PERSON_CONFIRMATION = re.compile(
    r"\s+(?:as (?:my|his|her|their) (?:chosen|preferred|full|legal) name|"
    r"as the name (?:i|we|they) (?:use|used) (?:for|at) (?:work|shifts|check[ -]?in)|"
    r"that[’']?s the name (?:the )?(?:shift lead|staff|crew|clerk) (?:uses|knows)|"
    r"as the person (?:collecting|receiving|picking up) (?:the|my|our) (?:order|pickup))\b",
    re.I,
)


def _candidate(text, start, end):
    value = text[start:end].strip()
    words = list(_WORD.finditer(value))
    if not 2 <= len(words) <= 6 or _CONTEXT_WORDS.search(value):
        return None
    if " ".join(word.group() for word in words) != value:
        return None
    return Hit("person", start, start + len(value))


def confirmed_name_slots(text):
    for prefix, suffix in ((_RECORD, _CONFIRMATION), *_PAIRED_FIELDS):
        for cue in prefix.finditer(text):
            start = cue.end()
            confirmation = suffix.search(text, start, min(len(text), start + 72))
            if confirmation:
                hit = _candidate(text, start, confirmation.start())
                if hit:
                    yield hit
    for cue in _DIRECT.finditer(text):
        start = cue.end()
        end = min(len(text), start + 72)
        stop = _STOP.search(text, start, end)
        hit = _candidate(text, start, stop.start() if stop else end)
        if hit:
            yield hit


def record_name_slots(text, contextual):
    """Recover name values with a personal record cue and a local boundary."""
    for prefix, suffix in ((_CARD_NAME, _ON_CARD), (_FIELD_RECORD, _PERSON_CONFIRMATION)):
        for cue in prefix.finditer(text):
            end = suffix.search(text, cue.end(), cue.end() + 72)
            if end:
                hit = _candidate(text, cue.end(), end.start())
                if hit and not _PUBLIC_RECORD.search(text[hit.start:hit.end]):
                    yield hit

    for pattern in (_RECEIPT_VALUE, _PERSON_RECORD):
        for cue in pattern.finditer(text):
            start = cue.end()
            limit = start + 72
            stop = _RECORD_END.search(text, start, limit)
            end = stop.start() if stop else len(text)
            if end > limit or (stop and stop.lastgroup == "nonperson"):
                continue
            if _PUBLIC_RECORD.search(text[start:end + 36]):
                continue
            hit = _candidate(text, start, end)
            if hit and (pattern is _PERSON_RECORD or any(
                other.label in {"person", "name"} and hit.start <= other.start < other.end <= hit.end
                and other.end - other.start >= 4 for other in contextual
            )):
                yield hit
