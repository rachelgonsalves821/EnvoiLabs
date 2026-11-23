"""Evaluate source-coordinate organization spans in explicit employment clauses."""

import re

from candidate import Hit


_SIGNAL = re.compile(
    r"\b(?:(?:(?:i|we) (?:used to |have been |had been )?|(?:i|we)[’']ve been )"
    r"(?:work|worked|working) (?:at|for)|(?:my|our|their) (?:employer|workplace) (?:is|was)|"
    r"(?:my|our|their|the) (?:paycheck|paycheque|pay check|pay cheque|payslip|pay slip|payroll) (?:comes|came) from|"
    r"(?:my|our) payroll (?:is|was) (?:at|with)|"
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


def _shape(text, start, end):
    phrase = text[start:end].rstrip()
    words = list(_WORD.finditer(phrase))
    if not 2 <= len(words) <= 6 or _NOT_NAME.search(phrase):
        return None
    pieces = [word.group().casefold() for word in words]
    if pieces[0] in _REJECTED or pieces[-1] in _REJECTED or " ".join(word.group() for word in words) != phrase:
        return None
    return Hit("employer", start, start + len(phrase))


def employer_slots(text):
    for pattern in (_CONTROL, _COLLEAGUE):
        for match in pattern.finditer(text):
            candidate = _shape(text, *match.span("name"))
            if candidate:
                yield candidate
    for cue in _SIGNAL.finditer(text):
        start = cue.end()
        end = min(start + 80, len(text))
        boundary = _END.search(text, start, end)
        if boundary:
            end = boundary.start()
        candidate = _shape(text, start, end)
        if candidate:
            yield candidate
