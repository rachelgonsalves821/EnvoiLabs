"""Score deterministic Presidio candidates before any researcher-facing publication."""

import argparse
import json
from importlib.metadata import version

import tldextract
from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

from holdout import build_holdout


MASK = "\uE000"
THRESHOLD = 0.35
RECALL_TARGETS = {"phone": 0.99, "email": 0.99, "person": 0.95, "employer": 0.95}
ANONYMIZER = AnonymizerEngine()
MASK_OPERATOR = {
    "DEFAULT": OperatorConfig("mask", {"masking_char": MASK, "chars_to_mask": 10_000, "from_end": False})
}


def candidate_analyzer():
    # Domain recognition and the installed NLP model must be available offline.
    tldextract.extract = tldextract.TLDExtract(cache_dir=None, suffix_list_urls=())
    nlp = NlpEngineProvider(nlp_configuration={
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
    }).create_engine()
    return AnalyzerEngine(nlp_engine=nlp, supported_languages=["en"])


def add_contact_patterns(analyzer):
    """Replay the existing exploratory patterns without adapting them to this holdout."""
    digit_word = r"(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)"
    street_word = r"(?-i:[A-Z][A-Za-z.'-]*)"
    street_suffix = (
        r"(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|"
        r"Boulevard|Blvd\.?|Court|Ct\.?|Way|Place|Pl\.?)"
    )
    address_number = r"(?:\d{1,6}|one|two|three|four|five|six|seven|eight|nine|ten)"
    patterns = [
        ("PHONE_NUMBER", "spoken-ten-digit-phone",
         rf"\b(?:one[ ,.-]+)?{digit_word}(?:[ ,.-]+{digit_word}){{9}}\b", 0.8, []),
        ("PHONE_NUMBER", "formatted-north-american-phone",
         r"(?<!\w)(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d{1,5})?(?!\w)",
         0.8, []),
        ("PHONE_NUMBER", "local-phone-with-context", r"(?<!\w)\d{3}[ .-]\d{4}(?!\w)",
         0.25, ["phone", "call", "number", "dial", "contact"]),
        ("EMAIL_ADDRESS", "spoken-email-domain",
         r"\b[\w.+-]+\s+at\s+[\w-]+(?:\s+dot\s+[\w-]+)*\s+dot\s+(?:com|org|net|edu|gov|test|ca|io)\b", 0.8, []),
        ("STREET_ADDRESS", "structured-street-address",
         rf"\b{address_number}\s+(?:{street_word}\s+){{1,4}}{street_suffix}(?:\s+(?:Apt\.?|Unit|Suite)\s+[A-Z0-9-]{{1,8}})?\b",
         0.8, []),
        ("STREET_ADDRESS", "post-office-box", r"\bP\.?\s*O\.?\s+Box\s+\d{1,8}\b", 0.8, []),
    ]
    for entity, name, expression, score, context in patterns:
        analyzer.registry.add_recognizer(PatternRecognizer(
            supported_entity=entity, name=name, patterns=[Pattern(name, expression, score)],
            context=context, supported_language="en",
        ))


def score(cases, mask):
    by_entity = {}
    clean_count = 0
    clean_altered = 0
    evidence_altered = 0
    for case in cases:
        redacted = mask(case.text)
        if len(redacted) != len(case.text) or MASK in case.text:
            raise ValueError("Benchmark requires a position-preserving mask and untouched source text.")
        evidence = case.evidence
        evidence_altered += redacted[evidence.start:evidence.end] != case.text[evidence.start:evidence.end]
        if not case.sensitive:
            clean_count += 1
            clean_altered += redacted != case.text
        for annotation in case.sensitive:
            counts = by_entity.setdefault(annotation.entity, {"planted": 0, "fully_masked": 0, "partially_masked": 0})
            counts["planted"] += 1
            span = redacted[annotation.start:annotation.end]
            full = span == MASK * len(span)
            counts["fully_masked"] += full
            counts["partially_masked"] += MASK in span and not full

    for counts in by_entity.values():
        counts["recall"] = counts["fully_masked"] / counts["planted"]
    return {
        "entities": dict(sorted(by_entity.items())),
        "clean_transcripts": clean_count,
        "clean_transcripts_altered": clean_altered,
        "research_evidence_altered": evidence_altered,
        "meets_prd_numeric_targets": all(
            by_entity[entity]["recall"] >= target for entity, target in RECALL_TARGETS.items()
        ),
    }


def masked_output(analyzer, text):
    detections = analyzer.analyze(text=text, language="en", score_threshold=THRESHOLD)
    return ANONYMIZER.anonymize(text=text, analyzer_results=detections, operators=MASK_OPERATOR).text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strict", action="store_true", help="Fail if the supplemented candidate misses a numeric target.")
    args = parser.parse_args()
    packages = {name: version(name) for name in (
        "presidio-analyzer", "presidio-anonymizer", "spacy", "en-core-web-sm", "phonenumbers", "tldextract",
    )}
    cases = build_holdout()
    analyzer = candidate_analyzer()
    baseline = score(cases, lambda text: masked_output(analyzer, text))
    add_contact_patterns(analyzer)
    supplemented = score(cases, lambda text: masked_output(analyzer, text))
    report = {
        "corpus": "synthetic-redaction-holdout-v1",
        "transcripts": len(cases),
        "threshold": THRESHOLD,
        "packages": packages,
        "prd_numeric_recall_targets": RECALL_TARGETS,
        "baseline": baseline,
        "supplemented": supplemented,
    }
    print(json.dumps(report, indent=2))
    return int(args.strict and not supplemented["meets_prd_numeric_targets"])


if __name__ == "__main__":
    raise SystemExit(main())
