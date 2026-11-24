"""Recover street-address spans introduced by a private location or delivery cue."""

import re

from candidate import Hit, _STREET
from spoken_contact import _CARDINAL, _STREET_SUFFIXES, _address_end, _digit, _number_end, tokenize


_PRIVATE_LOCATION = re.compile(
    r"\b(?:(?:my|our) (?:(?:reference|home|mailing|shipping|billing|street|delivery|private drop off) )?"
    r"address(?:es| (?:is|was|would be|at))?|"
    r"(?:the )?(?:return address(?: on [^,.!?;]{1,35}?)?|address for (?:this|the) delivery) (?:is|was)|"
    r"(?:my|our) (?:apartment|house|home|doorway) (?:at|is(?: at)?)|"
    r"(?:i|we) (?:live|lived|stay|stayed) at|where (?:i|we) live is|"
    r"the place (?:i(?:['’]m|m)|we(?:['’]re|re)) (?:renting|staying) (?:is|was)|"
    r"(?:the )?(?:billing|delivery|mailing) form (?:lists|says|shows)|"
    r"(?:the store|driver|courier|carrier) (?:dropped it|left it|delivered it) at|"
    r"(?:drop|leave) (?:it|(?:the|my|our) (?:parcel|packages?|order|boxes)) (?:at|by)|"
    r"(?:mail|ship|send|post) (?:it|(?:the|my|our) (?:paperwork|letter|packet|package|(?:sample )?card)) to|"
    r"(?:parcel|package|order) should come to|(?:drops?|delivers?|leaves?) (?:mine|ours) at|"
    r"(?:deliver|delivery) (?:to my address at|use))\s*[,:]?\s+", re.I,
)
_DESTINATION = re.compile(
    r"\b(?:ended up (?:at|outside)|(?:shared|split|took) a ride to|"
    r"(?:driver|courier)[^.!?;]{0,52}?\bstop (?:at|it))\s+", re.I,
)
_DELIVERY_ADDRESS = re.compile(r"\bthe delivery address (?:is|was)[ \t]*[:,]?[ \t]+", re.I)
_PUBLIC_DELIVERY_DESTINATION = re.compile(
    r"(?:[ \t]*,[ \t]*(?:(?:which|that) (?:is|was) )?|[ \t]+for[ \t]+)"
    r"(?:the |a )?public (?:(?:delivery|parcel|pickup) )?(?:counter|depot|hub|warehouse)\b",
    re.I,
)
_CLAUSE_END = re.compile(
    r"[,.!?;:]|\b(?:at the time|for (?:the|my|our)|before|after|by heart|"
    r"(?:i|we|they|he|she) (?:was|were|am|are|walked|called|took)|"
    r"and (?:i|we|they|the|then)|when|which|because|then)\b", re.I,
)
_MISHEARD_SUFFIX = {"rode", "lain", "terris"}
_MISHEARD_DIGIT = {"tree", "aid", "won"}
_EXTRA_UNITS = {"block", "tower"}
_UNIT_LETTER_VARIANTS = {"bee", "be", "see", "cee", "dee", "eff", "gee"}
_NON_ADDRESS = re.compile(
    r"\b(?:a\s?m|p\s?m|o['’]?clock|today|tomorrow|afternoon|evening|morning|tonight|minutes?|"
    r"dollars?|cents?|route|mile marker|tracking|order (?:code|number)|receipt (?:code|number))\b",
    re.I,
)
_DIRECT_LOCATION = re.compile(
    r"\b(?:(?:my|our) place (?:is|was) at|(?:the|my|our) (?:final|pickup|drop off) address (?:is|was)|"
    r"deliver (?:it|the parcel|my order) (?:to|at))\s+", re.I,
)
_PRIVATE_PREMISES = re.compile(
    r"\b(?:my|our) (?:home|residence|doorstep)(?: (?:is|was)(?: at)?| at|[:,])\s+", re.I,
)
_QUALIFIED_UNIT = re.compile(
    r"\s+(?:(?:front|rear|side|upper|lower) (?:apartment|apt|flat|unit|suite)|bungalow)(?: number)?\s+",
    re.I,
)
_UNIT_ACCESS = re.compile(r"\s+(?:front|rear|side) (?:door|entrance)\b", re.I)
_PREMISES_STREET_TYPE = re.compile(r"boul(?:e)? (?:uh )?vard\b", re.I)
_APPOINTMENT = re.compile(
    r"\b(?:(?:met|meet) (?:me|us) at|pick (?:me|us) up at|(?:front desk|reception)[^.!?;]{2,63}\bmade me at)\s+",
    re.I,
)
_DELIVERY_TURN = re.compile(r"\b(?:turn|pull) in at\s+", re.I)
_PARCEL_TRAIL = re.compile(
    r"\bwhere (?:i|we) (?:asked|told) (?:them|the (?:driver|courier)) to (?:leave|drop|deliver) (?:the |my )?"
    r"(?:parcel|order|package|box)\b", re.I,
)
_ROUTE_ENDPOINT = re.compile(
    r"\b(?:i|we) (?:started|began) (?:the |our )?(?:walk|trip) (?:beside|near|at|outside)\s+"
    r"[^.!?;]{4,68}?\band (?:i |we )?ended up (?:at|outside)\s+",
    re.I,
)
_WAYPOINT = re.compile(
    r"\b(?:bus stop|train station|[a-z]+ entrance|check[ -]?in marker|stop number|map pin|"
    r"public (?:exhibit|gate|display)|exit (?:sign|number)|platform|locker|aisle|building number|counter|dry cleaners)\b",
    re.I,
)
_CORROBORATED_STREET_TYPES = _STREET_SUFFIXES | _MISHEARD_SUFFIX | {
    "curt", "dry", "elaine", "plays", "streat", "terrorists", "weigh",
}
_STREET_WORD = re.compile(r"[^\W\d_]+(?:[-’'][^\W\d_]+)*\Z")
_STREET_ABBREVIATIONS = {"st", "ave", "rd", "dr", "ln", "blvd", "ct", "pl", "ter", "cir", "pkwy", "hwy", "trl", "sq"}
_WRITTEN_UNIT = re.compile(
    r"(?P<street_period>\.)?,?[ \t]+(?:apt(?P<unit_period>\.)?|apartment|suite|unit|flat)[ \t]+"
    r"(?:[0-9]{1,4}[a-z]?(?!\.[0-9])(?=$|[ \t\r\n,.;:!?])|[a-z](?=$|[\r\n,.;:!?]))",
    re.I | re.ASCII,
)
_HYPHENATED_HOUSE_NUMBER = re.compile(
    r"(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(?:one|two|three|four|five|six|seven|eight|nine)",
    re.I,
)
_SHAPED_UNIT = re.compile(
    r"(?P<street_period>\.)?,?[ \t]+(?:(?:front|rear|side|upper|lower) (?:apartment|apt\.?|flat|suite|unit)|"
    r"(?:apartment|apt\.?|flat|suite|unit) (?:number|no\.?))[ \t]+"
    r"[0-9]{1,4}[a-z]?(?!\.[0-9])(?=$|[ \t\r\n,.;:!?])",
    re.I | re.ASCII,
)
_SHAPED_STREET_TYPES = _STREET_SUFFIXES - {"way", "place", "pl", "trail", "trl", "loop", "highway", "hwy", "row"}
_STREET_PUBLIC_CONTEXT = re.compile(
    r"\b(?:public|advertised|directory|landmark|library|museum|store|shop|vendor|route|mile marker|exhibit|"
    r"passed|(?:walked|drove|rode) (?:past|along)|purchased|bought|sold|quote|price|total|item|model)\b",
    re.I,
)
_SHAPED_BOUNDARY = re.compile(r"\b(?:just (?:before|after)|even though)\b", re.I)


def _house_number_end(tokens, start):
    index = start
    reliable = 0
    while index < len(tokens) and index - start < 6:
        word = tokens[index].word
        decoded, confidence = _digit(word)
        if decoded or word in _CARDINAL:
            reliable += max(confidence, int(word in _CARDINAL))
        elif not (word in _MISHEARD_DIGIT and (
            reliable >= 2 or (index + 1 < len(tokens) and _digit(tokens[index + 1].word)[0])
        )):
            break
        index += 1
    return index, reliable


def _street_end(tokens, first, limit, private):
    for index in range(first + 1, min(limit, first + 5)):
        word = tokens[index].word
        if word in _STREET_SUFFIXES or (private and word in _MISHEARD_SUFFIX):
            return index + 1
        if private and word == "a" and index + 1 < limit and tokens[index + 1].word == "venue":
            return index + 2
    return first


def _unit_end(tokens, street_end):
    end = street_end
    for _ in range(3):
        next_end = _address_end(tokens, end)
        if next_end == end and end + 1 < len(tokens) and tokens[end].word in _EXTRA_UNITS:
            first = end + 1
            next_end = _number_end(tokens, first, allow_acoustic=True, limit=4)
            if next_end == first:
                word = tokens[first].word
                next_end = first + 1 if word in _UNIT_LETTER_VARIANTS or len(word) == 1 and word.isalpha() else end
        if next_end <= end:
            break
        end = next_end
    return end


def _written_unit_offset(text, street_type):
    if street_type.word not in _STREET_SUFFIXES:
        return None
    written = _WRITTEN_UNIT.match(text, street_type.end)
    # A period after a full street type can end the sentence. Only conventional abbreviations bridge it.
    if written and (written.group("street_period") or written.group("unit_period")) and (
        not written.group("street_period") or street_type.word in _STREET_ABBREVIATIONS
    ):
        return written.end()
    return None


def _qualified_unit_end(text, start, stop):
    unit = _QUALIFIED_UNIT.match(text, start, stop)
    if not unit:
        return start
    value = tokenize(text[unit.end():stop])
    if not value or value[0].start != 0:
        return start
    last = _number_end(value, 0, limit=3)
    if not last and (value[0].word in _UNIT_LETTER_VARIANTS or re.fullmatch(r"[a-z]", value[0].word)):
        last = 1
    if not last:
        return start
    end = unit.end() + value[last - 1].end
    access = _UNIT_ACCESS.match(text, end, stop)
    return access.end() if access else end


def _strong_street_shapes(text, tokens, offsets):
    for match in _STREET.finditer(text):
        number = match["number"]
        hyphenated = _HYPHENATED_HOUSE_NUMBER.fullmatch(number)
        if not (hyphenated or re.fullmatch(r"[0-9]{1,6}", number)):
            continue
        start = match.start()
        index = offsets.get(start)
        if index is None or tokens[index].end != match.end("number"):
            continue
        before = re.split(r"[.!?;\r\n]", text[max(0, start - 72):start])[-1]
        if _STREET_PUBLIC_CONTEXT.search(before):
            continue
        # Reuse the same street parser and source tokens as the private cue paths.
        first = index + 1
        street_end = _street_end(tokens, first, len(tokens), private=False)
        if not 2 <= street_end - first - 1 <= 4:
            continue
        street_type = tokens[street_end - 1]
        if (street_type.word not in _SHAPED_STREET_TYPES or street_type.end > match.end()
                or not all(_STREET_WORD.fullmatch(token.word) and text[token.start].isupper()
                           for token in tokens[first:street_end - 1])
                or not re.fullmatch(r"[^\r\n]+", text[start:street_type.end])
                or _PUBLIC_DELIVERY_DESTINATION.match(text, street_type.end)):
            continue
        unit = _SHAPED_UNIT.match(text, street_type.end)
        if unit and (not unit.group("street_period") or street_type.word in _STREET_ABBREVIATIONS):
            end = unit.end()
        elif hyphenated:
            end = _written_unit_offset(text, street_type) or tokens[_unit_end(tokens, street_end) - 1].end
        else:
            continue
        following = text[end:end + 48].lstrip()
        if not _PUBLIC_DELIVERY_DESTINATION.match(text, end) and (
            not following or _CLAUSE_END.match(following) or _SHAPED_BOUNDARY.match(following)
        ):
            yield Hit("address", start, end)


def recover_address_slots(text):
    tokens = tokenize(text)
    offsets = {token.start: index for index, token in enumerate(tokens)}
    for cue in (_PRIVATE_LOCATION, _DELIVERY_ADDRESS, _DESTINATION):
        private = cue is _PRIVATE_LOCATION
        for prefix in cue.finditer(text):
            start = offsets.get(prefix.end())
            if start is None:
                continue
            first, reliable = _house_number_end(tokens, start)
            parts = first - start
            if not parts or parts > 5 or (parts == 1 and not tokens[start].word.isdigit()):
                continue
            stop = min(len(text), prefix.end() + 86)
            boundary = _CLAUSE_END.search(text, prefix.end(), stop)
            stop = boundary.start() if boundary else stop
            limit = first
            while limit < len(tokens) and tokens[limit].end <= stop:
                limit += 1
            tail = text[tokens[first - 1].end:stop]
            end = _street_end(tokens, first, limit, private)
            written_offset = None
            if end > first and (reliable or private or parts >= 3):
                if _NON_ADDRESS.search(text[tokens[first - 1].end:tokens[end - 1].end]):
                    continue
                street_type = tokens[end - 1]
                if cue is _DELIVERY_ADDRESS and _PUBLIC_DELIVERY_DESTINATION.match(text, street_type.end):
                    continue
                if private or cue is _DELIVERY_ADDRESS:
                    written_offset = _written_unit_offset(text, street_type)
                end = _unit_end(tokens, end)
            elif private and reliable >= 2 and parts >= 2 and not _NON_ADDRESS.search(tail):
                end = next((unit for index in range(first + 2, min(limit, first + 6))
                            if (unit := _unit_end(tokens, index)) > index), limit)
                if end == limit and not 2 <= limit - first <= 5:
                    continue
            else:
                continue
            yield Hit("address", tokens[start].start, written_offset or tokens[end - 1].end)


def recover_corroborated_addresses(text):
    """Use stronger location relations when the spoken street type is damaged."""
    tokens = tokenize(text)
    offsets = {token.start: index for index, token in enumerate(tokens)}
    for cue in (_PRIVATE_LOCATION, _DELIVERY_ADDRESS, _DIRECT_LOCATION, _PRIVATE_PREMISES, _APPOINTMENT, _DELIVERY_TURN,
                _ROUTE_ENDPOINT):
        for match in cue.finditer(text):
            start = offsets.get(match.end())
            if start is None:
                continue
            first, reliable = _house_number_end(tokens, start)
            house = tokens[start:first]
            if not 1 <= len(house) <= 5 or reliable < 1:
                continue
            end = min(len(text), match.end() + 76)
            boundary = _CLAUSE_END.search(text, match.end(), end)
            if cue is _DELIVERY_TURN:
                boundary = _PARCEL_TRAIL.search(text, match.end(), end)
                if boundary is None:
                    continue
            if boundary:
                end = boundary.start()
            street = []
            for token in tokens[first:first + 5]:
                if token.end > end or not _STREET_WORD.fullmatch(token.word):
                    break
                street.append(token)
            tail = text[house[-1].end:end]
            premises = cue is _PRIVATE_PREMISES
            if len(street) < 2 or _NON_ADDRESS.search(tail) or (not premises and _WAYPOINT.search(tail)):
                continue
            street_types = _STREET_SUFFIXES if cue is _DELIVERY_ADDRESS else _CORROBORATED_STREET_TYPES
            street_end = next((first + index + 1 for index, token in enumerate(street)
                               if index and token.word in street_types), None)
            if street_end is None and cue is not _DELIVERY_ADDRESS:
                street_end = next((first + index + 2 for index, _ in enumerate(street[:-1])
                                   if index and (street[index].word, street[index + 1].word) in {
                                       ("a", "venue"), ("av", "enue"),
                                   }), None)
            if street_end is None and premises:
                street_ends = {token.end: first + index + 1 for index, token in enumerate(street)}
                for token in street[1:]:
                    suffix = _PREMISES_STREET_TYPE.match(text, token.start, end)
                    if suffix and suffix.end() in street_ends:
                        street_end = street_ends[suffix.end()]
                        break
            if street_end is not None and (cue is not _ROUTE_ENDPOINT or reliable >= 2):
                street_type = tokens[street_end - 1]
                if cue is _DELIVERY_ADDRESS and _PUBLIC_DELIVERY_DESTINATION.match(text, street_type.end):
                    continue
                last_offset = tokens[_unit_end(tokens, street_end) - 1].end
                written_offset = (
                    _written_unit_offset(text, street_type)
                    if cue in (_PRIVATE_LOCATION, _DELIVERY_ADDRESS, _DIRECT_LOCATION, _PRIVATE_PREMISES) else None
                )
            elif (cue is _ROUTE_ENDPOINT and reliable >= 3 and len(house) >= 3 and (boundary or end == len(text))
                  and 2 <= len(street) <= 4 and not text[street[-1].end:end].strip()):
                last_offset = street[-1].end
                written_offset = None
            else:
                continue
            if premises:
                street_offset = tokens[street_end - 1].end
                last_offset = _qualified_unit_end(text, last_offset if last_offset <= end else street_offset, end)
                if (_WAYPOINT.search(text, house[-1].end, street_offset)
                        or _WAYPOINT.search(text, last_offset, end)):
                    continue
            yield Hit("address", tokens[start].start, written_offset or last_offset)
    yield from _strong_street_shapes(text, tokens, offsets)
