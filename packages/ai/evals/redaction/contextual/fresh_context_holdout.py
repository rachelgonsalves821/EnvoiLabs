"""Synthetic text fixtures with new contact formats and less explicit context."""

import random

from holdout import Span, Transcript


FIRST = ("Eleni", "Naveen", "Juno", "Saskia", "Soren", "Kito", "Marta", "Avery", "Imani", "Sana")
LAST = ("Vellerin", "Mortwain", "Renslow", "Caldern", "Zavian", "Bramwick", "Lysen", "Ostet")
EMPLOYERS = (
    "Copper Thimble Works", "Forest Violet", "Windrow Teal Systems", "Amber Kite Prints",
    "Snowdrift Studio", "Hollow Birch Coffee", "Sunwashed Tile", "Silver Reed Workshop",
)
STREETS = ("Aspen Chalk", "Topaz Moor", "Juniper Glass", "Honey Brook", "Nightingale Loop", "Slate Harp")
RESEARCH = (
    "The second delivery estimate was much higher than the first one.",
    "I switched to pickup when the app added a six-dollar fee.",
    "The menu called it Night Market Soup, but there was no picture.",
    "I waited until 7:17 and asked for a refund.",
    "I searched for Cedar Hall Pickup because it was the nearest drop point.",
    "The receipt said number 74, but the counter called 47.",
    "The star rating was the same for both options.",
    "I missed the toggle and accidentally chose the large size.",
    "My roommate suggested we use the first-time discount.",
    "I bought a single wrap and two drinks for nine dollars.",
    "I only trust photos posted by customers.",
    "They brought the order before the timer ran out.",
    "The store showed a twenty-five to thirty minute wait.",
    "The delivery person called once and left the food outside.",
    "The confirmation changed to 'Order ready' just as I tapped it.",
    "I would pay two dollars less if I picked it up after work.",
    "I tried the lower shelf in the pickup area first.",
    "The app offered two sizes and a midday bundle.",
    "The red banner let me know why I couldn't tap checkout.",
    "I didn't need the filter, but it remembered my preference.",
)


def build_fresh_holdout():
    rng = random.Random(2189)
    cases = []
    for index in range(80):
        mode = index % 8
        serial = index + 100
        name = f"{FIRST[index % 10]} {LAST[index // 10]}"
        employer = EMPLOYERS[(index * 5) % len(EMPLOYERS)]
        street = STREETS[index % len(STREETS)]
        ending = f"01{index:02}"
        phone = (
            f"(202) 555 {ending}", f"+1.202.555.{ending}", f"202-555-{ending}",
            f"202/555/{ending}", f"555 {ending}", f"202555{ending}",
            "two oh two, five five five, zero one " + " ".join(
                ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine")[int(n)]
                for n in ending[-2:]
            ),
            f"202 555 {ending} extension 42",
        )[mode]
        email = (
            f"mail{serial}@example.com", f"M{serial}+pickup@relay.example.net",
            f"pickup_{serial}@example.org", f"blue underscore car{serial} at example dot net",
            f"blue dash car{serial} at example dot org", f"blue car{serial} at example dot com",
            f"mail{serial} at example.com", f"mail{serial} (at) example (dot) net",
        )[mode]
        address = (
            f"{serial} {street} Blvd, floor 11", f"{serial} north {street} Street",
            f"{serial} {street.lower()} ave #11", f"Post Office BOX {serial}",
            f"{serial} {street} Ct., Apartment 4", f"{serial} {street} Terrace",
            f"{serial} {street} road, unit 15-A", f"{serial} {street} Drive, Building D",
        )[mode]
        fields = [
            ("person", name.lower() if mode in (2, 5) else name,
             ("They filed it under ", "I introduced myself as ", "The account showed ", "I checked it as ")[index % 4]),
            ("employer", employer.lower() if mode in (1, 6) else employer,
             ("My pay comes from ", "I was on a shift at ", "My team worked at ", "I have a job at ")[index % 4]),
            ("email", email, ("The confirmation was addressed to ", "I used ", "I asked them to write to ", "They sent it to ")[index % 4]),
            ("phone", phone, ("For a text I gave them ", "The contact field showed ", "My number ended up as ", "I said to dial ")[index % 4]),
            ("address", address, ("They dropped it by ", "I was staying at ", "The driver asked for ", "The destination was ")[index % 4]),
        ]
        if index % 4 == 1:
            fields.append(("school", f"{street} Conservatory", "My class was at "))
        rng.shuffle(fields)
        text, annotations = "", []
        evidence_text = RESEARCH[index % len(RESEARCH)]
        offset = rng.randrange(len(fields) + 1)
        for position, field in enumerate([*fields, None]):
            if position == offset:
                evidence = Span("evidence", len(text), len(text) + len(evidence_text))
                text += evidence_text + " "
            if field is not None:
                entity, value, prompt = field
                start = len(text) + len(prompt)
                annotations.append(Span(entity, start, start + len(value)))
                text += prompt + value + ". "
        cases.append(Transcript(text.rstrip(), tuple(annotations), evidence))
    return cases + [Transcript(text, (), Span("evidence", 0, len(text))) for text in RESEARCH]
