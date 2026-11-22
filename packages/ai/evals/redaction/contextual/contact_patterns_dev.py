"""Development-only contact candidate. Use fresh labeled outputs for qualification."""

import re

from presidio_analyzer import RecognizerResult


spoken_email = re.compile(
    r"\b[\w%+-]+(?:\.[\w%+-]+)*(?:\s+(?:dot|underscore|dash|hyphen|plus)\s+[\w%+-]+)*"
    r"\s+at\s+[\w-]+(?:\s+dot\s+[\w-]+)*\s+dot\s+(?:com|org|net|edu|gov|test|ca|io)\b",
    re.IGNORECASE,
)
street_address = re.compile(
    r"\b\d{1,6}\s+(?:(?:n|s|e|w)\.?\s+)?(?:[a-z][a-z.'-]*\s+){1,4}"
    r"(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?|court|ct\.?|way|place|pl\.?)"
    r"(?=\s|[,.#]|$)(?:\s*,?\s+(?:apt\.?|unit|suite|floor)\s+[a-z0-9-]{1,8}|\s*#\s*[a-z0-9-]{1,8})?",
    re.IGNORECASE,
)
postal_box = re.compile(r"\b(?:p\.?\s*o\.?|post\s+office)\s+box\s+\d{1,8}\b", re.IGNORECASE)


def contact_results(text):
    for label, pattern in (
        ("EMAIL_ADDRESS", spoken_email),
        ("STREET_ADDRESS", street_address),
        ("STREET_ADDRESS", postal_box),
    ):
        for result in pattern.finditer(text):
            yield RecognizerResult(label, result.start(), result.end(), 0.9)
