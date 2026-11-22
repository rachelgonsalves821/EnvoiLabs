"""Recognize explicit identity clauses and restore bounded cues for local NER."""

from dataclasses import dataclass
import re

from candidate import Hit
from spoken_contact import tokenize


_CUES = {
    "person": (
        r"my (?:(?:first|last|full) )?name (?:is|was)|i (?:go|went) by|"
        r"(?:the |my )?(?:account|profile|badge) (?:said|says|listed|shows?|showed)|"
        r"(?:the )?name on (?:the|my) (?:account|order|badge) (?:is|was)|"
        r"(?:introduced|identified) myself as|(?:filed|entered|listed|saved|signed) (?:it )?(?:under|as)|"
        r"(?:i am|i'm) called|(?:my |the )?(?:driver|courier|manager|roommate|coworker|colleague) (?:was|is|named)|"
        r"(?:they|people) call me"
    ),
    "employer": (
        r"(?:(?:my|the|our) )?employer(?:'s name)? (?:is|was)|"
        r"i (?:work|worked) (?:for|at)|i (?:was|am) on a shift at|"
        r"(?:my|our) (?:workplace|company|work site|office) (?:is|was)|"
        r"(?:my|the) (?:paycheck|pay cheque|pay) (?:comes|came) from|"
        r"(?:had|have) a job at|(?:the|my) (?:badge|uniform) (?:listed|showed|said)"
    ),
    "school": (
        r"(?:i|we) (?:attend|attended|go to|went to|study at|studied at|enroll in|enrolled in)|"
        r"(?:my|the|our) (?:school|college|university|campus) (?:is|was|is called|was called)|"
        r"(?:my|our) (?:class|classes|course|courses|degree|seminar|lecture) (?:is|are|was|were) (?:at|from)"
    ),
}
_IDENTITY_ANCHOR = {
    label: re.compile(rf"\b(?:{patterns})\s+", re.I) for label, patterns in _CUES.items()
}
_CLAUSE_END = re.compile(
    r"\b(?:because|since|during|when|where|which|whose|before|after|near|today|yesterday|"
    r"on (?:a|the|my)\b|with (?:a|the|my)\b|at (?:a|the|my|home|work)\b|"
    r"from (?:a|the|my|[0-9])\b|this (?:week|morning|semester)|last (?:night|week|year)|"
    r"(?:(?:and|but|then|while|so)\s+)?(?:i|we|they|he|she|it|my|our|the)\s+"
    r"(?:ordered|called|said|prefer|was|is|are|were|waited|noticed|picked|used|took|had|usually|wanted|"
    r"asked|thought|saw|tried|wanted|got|paid|could|can|would|did|do|didn't|don’t|don't|still|never|"
    r"app|order|delivery|courier|checkout|phone|food|price|button|receipt|one|service)\b|"
    r"(?:and|but|while|so|then) (?:i|we|my|our|the|it|they|he|she)\b)",
    re.I,
)
_BOUNDARY = re.compile(r"[.,!?;:\n]")
_NON_NAME = {"a", "an", "there", "here", "nobody", "somewhere", "someone", "still", "just", "never", "on", "at"}
_CONNECTOR = {"a", "an", "and", "at", "for", "in", "of", "the", "van", "von", "de", "del", "la"}


def explicit_identities(text):
    for label, regex in _IDENTITY_ANCHOR.items():
        for anchor in regex.finditer(text):
            start = anchor.end()
            context = text[start:start + 100]
            boundary = _BOUNDARY.search(context)
            clause_end = _CLAUSE_END.search(context)
            end = min(len(context), *(match.start() for match in (boundary, clause_end) if match), len(context))
            tokens = tokenize(context[:end])
            if not tokens or tokens[0].word in _NON_NAME or tokens[0].word.isnumeric():
                continue
            first = int(tokens[0].word == "the")
            count = min(len(tokens), first + (4 if label == "person" else 7))
            significant = [token for token in tokens[first:count] if token.word not in _CONNECTOR and token.word.isalpha()]
            if len(significant) < 2:
                continue
            yield Hit(label, start + tokens[first].start, start + tokens[count - 1].end)


@dataclass(frozen=True)
class Restored:
    text: str
    offsets: tuple[int | None, ...]

    def project(self, start, end, label):
        if not 0 <= start < end <= len(self.offsets):
            raise ValueError("Restored hit offsets outside the model input")
        covered = [origin for origin in self.offsets[start:end] if origin is not None]
        return Hit(label, covered[0], covered[-1] + 1) if covered else None


def restore_for_model(text, identities, *, broad=False):
    sentence_start = {0}
    for match in re.finditer(r"[.!?]\s+(?=\w)|\n+\s*(?=\w)", text):
        sentence_start.add(match.end())
    identity_tokens = {
        token.start
        for token in tokenize(text)
        if token.word not in _CONNECTOR and any(hit.start <= token.start < hit.end for hit in identities)
    }
    if broad:
        identity_tokens.update(token.start for token in tokenize(text) if token.word not in _CONNECTOR)
    insertion = {hit.end for hit in identities if hit.end < len(text) and text[hit.end].isspace()}
    for offset in insertion:
        following = re.match(r"\s+(?=\w)", text[offset:])
        if following:
            sentence_start.add(offset + following.end())
    characters, offsets = [], []
    for offset, char in enumerate(text):
        if offset in insertion:
            characters.append(".")
            offsets.append(None)
        upper = char.upper()
        if offset in identity_tokens | sentence_start and len(upper) == 1:
            char = upper
        characters.append(char)
        offsets.append(offset)
    return Restored("".join(characters), tuple(offsets))
