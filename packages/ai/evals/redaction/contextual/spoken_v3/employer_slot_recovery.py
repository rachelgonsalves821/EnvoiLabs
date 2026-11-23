"""Evaluate source-coordinate organization spans in explicit employment clauses."""

import re

from candidate import Hit


_PAY_SOURCE = (
    r"(?:my|our|their|the) (?:paycheck|paycheque|pay check|pay cheque|payslip|pay slip|payroll) (?:comes|came) from|"
    r"(?:my|our) payroll (?:is|was) (?:at|with)"
)
_SIGNAL = re.compile(
    r"\b(?:(?:(?:i|we) (?:used to |have been |had been )?|(?:i|we)[’']ve been )"
    r"(?:work|worked|working) (?:at|for)|(?:my|our|their) (?:employer|workplace) (?:is|was)|"
    rf"{_PAY_SOURCE}|"
    r"(?:from|at) work (?:that[’']s|that is|which is)|where i work (?:it[’']s|it is)|"
    r"(?:i|we) (?:arrived|arrive|showed up|came in) for (?:my|our|the) (?:\w+ ){0,2}shift at)\s+",
    re.I,
)
_CONTROL = re.compile(
    r"\b(?:put|entered|typed|listed|wrote)\s+(?P<name>[^;:!?.\n]{2,64}?)\s+"
    r"in (?:the|my|our) (?:employer|workplace|company) (?:name )?field\b",
    re.I,
)
_COLLEAGUE = re.compile(
    r"\b(?:a|my|our) (?:colleague|coworker|co-worker) (?:at|from)\s+"
    r"(?P<name>[^;:!?.\n]{2,64}?)\s+(?=said|told|recommended|suggested|mentioned)\b",
    re.I,
)
_END = re.compile(
    r"[,.;:!?]|\b(?:since|because|before|after|during|unless|until|while|which|where|"
    r"around (?:here|there)|(?:the|my|our) (?:order|receipt|account|pickup|shipping)|"
    r"(?:and |then |but |so )?(?:i|we|they|you) (?:work|came|called|said|put|were|was|"
    r"used|have|wanted|met|got|normally|usually)|[iw](?:[’']m|[’']ve)|"
    r"(?:the|my|our) (?:app|store|website|menu) (?:shows|said|listed|is|was|loaded))\b",
    re.I,
)
_WORD = re.compile(r"[^\W\d_]+(?:['’\-][^\W\d_]+)*")
_REJECTED = {
    "an", "and", "at", "for", "from", "here", "inside", "my", "near", "noon", "our", "that",
    "there", "today", "tomorrow", "with", "you", "yesterday",
}
_NOT_NAME = re.compile(
    r"\b(?:noon|midnight|morning|evening|o clock|minutes?|hours?|pickup code|order number|"
    r"the counter|the (?:front|back) desk|until then|from home|the mall|a store|the (?:main|back) door|"
    r"the (?:public|online)|this week|last week|"
    r"(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) "
    r"(?:fifteen|thirty|forty|forty five|each|every|in the|a m|p m))\b",
    re.I,
)
_EMPLOYMENT_RECORD = re.compile(
    rf"\b(?:{_PAY_SOURCE}|(?:the (?:company|firm|employer) (?:on|listed on) (?:my|our) "
    r"(?:payslip|pay slip|paycheck|paycheque|pay check|pay cheque)|(?:my|our) employer of record) (?:is|was)|"
    r"(?P<shifts>(?:my|our) shifts (?:are|were) (?:assigned|scheduled) by)|"
    r"(?:i|we) (?:file|filed|request|requested) (?:leave|time off) (?:with|through) the hr (?:office|department) of|"
    r"(?:my|our) (?:new |current )?supervisor at)\s+",
    re.I,
)
_LEGAL_END = re.compile(
    r"\b(?:llc|llp|ltd|inc|corp|co|plc)\b(?:\.(?=$|\s|[,;:!?])|"
    r"(?=$|[,;:!?]|\s+(?:and|but|offered|asked|approved|assigned|gave|sent|said|told)\b))",
    re.I,
)
_SERVICES_END = re.compile(r"\bservices\b(?=$|[,.!?;:]|\s+(?:and|but)\b)", re.I)
_INITIAL_PAIR = re.compile(r"\b[^\W\d_] and [^\W\d_]\b", re.I)
_RELATION_PROSE = re.compile(
    r"\b(?:a|an|the|another|by|from|at|of|for|vs|i|we|you|they|it|he|she|my|our|their|your|"
    r"its|is|are|was|were|had|has|have|then|that|this|these|those|but|or|payroll|staffing agency|"
    r"supervisors?|managers?|teams?|crews?|temporary staff)\b",
    re.I,
)


def _shape(text, start, end, max_words=6):
    phrase = text[start:end].rstrip()
    words = list(_WORD.finditer(phrase))
    if not 2 <= len(words) <= max_words or _NOT_NAME.search(phrase):
        return None
    pieces = [word.group().casefold() for word in words]
    if pieces[0] in _REJECTED or pieces[-1] in _REJECTED or " ".join(word.group() for word in words) != phrase:
        return None
    return Hit("employer", start, start + len(phrase))


def _record_organization(text, cue):
    start = cue.end()
    limit = min(start + 80, len(text))
    matches = [_LEGAL_END.search(text, start, limit)]
    if cue.group("shifts"):
        matches.append(_SERVICES_END.search(text, start, limit))
    # A corroborated ending closes the value before the next clause.
    for match in sorted((hit for hit in matches if hit), key=lambda hit: hit.start()):
        phrase = text[start:match.end()]
        initials = _INITIAL_PAIR.search(phrase)
        if _RELATION_PROSE.search(_INITIAL_PAIR.sub(" ", phrase)) or (match.re is _SERVICES_END and not initials):
            continue
        # A bare conjunction after a generic role is not evidence that a public name belongs to that role.
        words = [word.group().casefold() for word in _WORD.finditer(phrase)]
        if words.count("and") > 1 or (not initials and "and" in words[:3]):
            continue
        name_end = match.end() - int(phrase.endswith("."))
        if _shape(text, start, name_end, max_words=10):
            return Hit("employer", start, match.end())
    return None


def employer_slots(text):
    for pattern in (_CONTROL, _COLLEAGUE):
        for match in pattern.finditer(text):
            candidate = _shape(text, *match.span("name"))
            if candidate:
                yield candidate
    record_starts = set()
    for cue in _EMPLOYMENT_RECORD.finditer(text):
        candidate = _record_organization(text, cue)
        if candidate:
            record_starts.add(candidate.start)
            yield candidate
    for cue in _SIGNAL.finditer(text):
        start = cue.end()
        if start in record_starts:
            continue
        end = min(start + 80, len(text))
        boundary = _END.search(text, start, end)
        if boundary:
            end = boundary.start()
        candidate = _shape(text, start, end)
        if candidate:
            yield candidate
