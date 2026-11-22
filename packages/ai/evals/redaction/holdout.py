"""Build frozen synthetic transcript fixtures. None originate from people or a vendor."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Span:
    entity: str
    start: int
    end: int


@dataclass(frozen=True)
class Transcript:
    text: str
    sensitive: tuple[Span, ...]
    evidence: Span


NAMES = (
    "Dalia", "Niko", "Asha", "Ines", "Saul", "Alva", "Nadia", "Amir",
    "Nora", "Belen", "Tariq", "Iris", "Micah", "Lin", "Priya", "Celia",
    "Hugo", "Noemi", "Arjun", "Leona",
)
SURNAMES = ("Rindle", "Marlinne", "de Verri", "Kestlen")
EMPLOYERS = (
    "Birch Echo", "Grey Orchard Group", "Velvet Ferry Bakery", "Opal Harbor",
    "Woven Bell Studio", "Tern Cart Logistics", "Torch Acre Design", "Saffron Beacon",
    "Plaincrest Health", "Lark Canoe Workshop", "Crescent Nest Lab", "Dove Prism Co",
    "Maple Ember Books", "Pine Loom Supply", "Aster Reach Systems", "Marble Orchard",
)
SCHOOLS = (
    "Linden Frame College", "Aster Bridge University", "Reedhaven Polytechnic", "Grove Wing Institute",
    "Marshlight School of Design", "Spurel College", "West Tern University", "Plainbell Technical College",
)
STREETS = (
    "Bracken Bell", "Topaz Canal", "Fable Meadow", "Rainy Quill", "Foxglove Gate",
    "Gilded Tern", "Linen Brook", "Cobalt Fern", "Moss Ledge", "Canvas Spur",
)
SAFE_EVIDENCE = (
    "I stopped after the third checkout error.",
    "I placed it before 11:45 a.m. to beat the lunch queue.",
    "The total went from $18.25 to $22.60 at checkout.",
    "The map estimated twenty to twenty-five minutes.",
    "I would use pickup for anything over five dollars in fees.",
    "The notification said Monday, although I checked on Sunday.",
    "The first button said North Gate Pickup, so I tapped it.",
    "I ordered four spinach wraps and two ginger drinks.",
    "The order reference was 76032412 on the confirmation page.",
    "The words 'quiet hours' made it obvious what to do.",
    "I watched three short videos while the status was pending.",
    "Seven dollars for delivery is above what I would usually pay.",
    "There was a note about the South Atrium Entrance.",
    "I chose Midnight Bean from the drinks menu.",
    "My ETA changed twice between 6:26 and 6:41.",
    "I found this week's discount under Lunch Rewards.",
    "I chose the small size because the photo made it look large.",
    "The app said order 701463 and the kiosk displayed 701364.",
    "The 'Blue Orange' flavor was already sold out.",
    "I waited seventeen minutes before asking about the refund.",
)
DIGIT_WORDS = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine")


def planted_values(index):
    name = f"{NAMES[index % 20]} {SURNAMES[index // 20]}"
    if index % 7 == 2:
        name = name.lower()
    elif index % 7 == 4:
        name = f"{name[0]}. {name.split(' ', 1)[1]}"

    tail = f"{100 + index:04}"
    spoken = " ".join(DIGIT_WORDS[int(digit)] for digit in "303555" + tail)
    phone = (
        f"+1 (303) 555-{tail}", f"303.555.{tail}", f"303555{tail}",
        f"555-{tail}", spoken, spoken.replace("zero", "oh"),
        f"(303) 555 {tail} ext. {30 + index}", f"1-303-555-{tail}",
    )[index % 8]

    local = f"sample.agent{index + 41}"
    email = (
        f"{local}@example.net", f"{local}+receipt@example.org",
        f"{local.replace('.', '_')}@example.com", f"{local}@archive.example.com",
        f"{local} at example dot net", f"{local} at inbox dot example dot org",
        f"{local.upper()}@example.net", f"sample dot agent{index + 41} at example dot test",
    )[index % 8]

    street = STREETS[index % len(STREETS)]
    number = 180 + index
    address = (
        f"{number} {street} Avenue", f"{number} {street} Dr. Unit 5",
        f"{number} {street.lower()} lane apt 13b", f"{number} W. {street} Road Suite R4",
        f"P.O. Box {number}", f"post office box {number}",
        f"{number} {street} Boulevard, floor 3", f"{number} {street} Way #7",
    )[index % 8]

    employer = EMPLOYERS[index % len(EMPLOYERS)]
    if index % 6 == 1:
        employer = employer.lower()
    elif index % 6 == 3:
        employer += " North Office"
    return name, phone, email, address, employer


def sentence_parts(index):
    name, phone, email, address, employer = planted_values(index)
    # These alternatives include lowercasing, punctuation changes and cloud-ASR-like verbal forms.
    context = index % 4
    parts = [
        ("person", ("The form showed ", "I said my name is ", "My coworker ", "It addressed me as ")[context], name),
        ("phone", ("They could reach me at ", "My callback number was ", "I had saved ", "The number to call was ")[context], phone),
        ("email", ("The receipt went to ", "I spelled my email as ", "The account address was ", "I signed in with ")[context], email),
        ("address", ("The bag went to ", "My apartment address is ", "The courier could not locate ", "The return address was ")[context], address),
        ("employer", ("I book shifts with ", "I work for ", "My last employer was ", "I get my schedule from ")[context], employer),
    ]
    ordered = parts[context:] + parts[:context]
    if index % 4 == 0:
        ordered.append(("school", "I was a student at ", SCHOOLS[(index // 4) % len(SCHOOLS)]))
    return ordered


def build_holdout():
    """Eighty positive transcripts and twenty clean transcripts for false positives."""
    cases = []
    for index in range(80):
        text, sensitive = "", []
        evidence_text = SAFE_EVIDENCE[index % len(SAFE_EVIDENCE)]
        for entity, prefix, value in sentence_parts(index):
            start = len(text) + len(prefix)
            sensitive.append(Span(entity, start, start + len(value)))
            text += prefix + value + ". "
        evidence = Span("evidence", len(text), len(text) + len(evidence_text))
        cases.append(Transcript(text + evidence_text, tuple(sensitive), evidence))
    return cases + [Transcript(text, (), Span("evidence", 0, len(text))) for text in SAFE_EVIDENCE]
