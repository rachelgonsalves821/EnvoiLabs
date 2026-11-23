"""Apply the same source-offset redaction policy in evaluation and private processing."""

from time import perf_counter

from address_slot_recovery import recover_address_slots, recover_corroborated_addresses
from candidate import Hit, candidate_hits
from confirmed_names import confirmed_name_slots, record_name_slots
from email_slot_recovery import recover_corroborated_mailboxes, recover_email_slots
from employer_slot_recovery import employer_slots
from identity_boundaries import complete_identity_boundaries
from person_slot_recovery import detect_person_slots
from phone_slot_recovery import recover_corroborated_numbers, recover_number_slots
from product_context import is_explicit_commercial_reference, is_product_title
from public_website_context import (
    explicit_spoken_locator_ranges, inside_public_locator, preserving_public_ref, public_website_ranges,
)
from redaction_input import RedactionInputTooLong, answer_windows
from speech_context import explicit_identities, restore_for_model
from spoken_contact import spoken_contact_hits
from spoken_contacts_recover import recovered_contacts


_LABELS = ["person", "organization", "phone number", "email address", "address"]
_IDENTITY_LABELS = ["name", "organization", "organization educational"]
CANDIDATE = "with_literal_contacts_and_public_locators"


def _project_identities(view, predict):
    for detection in predict(view.text, _IDENTITY_LABELS):
        projected = view.project(detection.start, detection.end, detection.label)
        if projected:
            yield projected


def frozen_v2_components(text, deterministic, predict):
    pres = tuple(deterministic(text))
    raw = tuple(predict(text, _LABELS))
    spoken = tuple(spoken_contact_hits(text))
    explicit = tuple(explicit_identities(text))
    fixed = tuple(candidate_hits(text, pres, ()))
    restored = restore_for_model(text, explicit, broad=False)
    contextual = (
        *(hit for hit in candidate_hits(text, (), raw) if hit in raw),
        *_project_identities(restored, predict),
    )
    return (*fixed, *spoken), contextual, explicit


def span_variants(text, deterministic, predict, restore=None, *, timings=None):
    """Yield comparison masks as validated source spans from injected local detectors."""
    fixed, contextual, explicit = frozen_v2_components(text, deterministic, predict)
    began = perf_counter()
    additional = tuple(recovered_contacts(text))
    if timings is not None:
        timings["contacts"].append(perf_counter() - began)
    yield "frozen_v2", (*fixed, *contextual)
    yield "v2_plus_contact_recovery", (*fixed, *contextual, *additional)
    product_context = tuple(hit for hit in contextual if not is_product_title(text, hit, explicit))
    product_masks = (*fixed, *additional, *product_context)
    yield "v2_plus_contact_and_product_context", product_masks
    email_slots = tuple(recover_email_slots(text))
    if restore is None:
        yield "with_spoken_email_repairs", (*product_masks, *email_slots)
        return

    began = perf_counter()
    lower = text.lower()
    if len(lower) != len(text):
        raise ValueError("Casing input changes its source offsets")
    restored = restore(lower)
    cased_identities = tuple(
        hit for hit in _project_identities(restored, predict) if not is_product_title(text, hit, explicit)
    )
    if timings is not None:
        timings["casing"].append(perf_counter() - began)
    with_casing = (*fixed, *additional, *cased_identities)
    combined = (*with_casing, *product_context)
    yield "v2_plus_contact_product_and_casing", combined
    yield "v2_plus_contact_product_casing_only", with_casing
    detections = (*product_context, *cased_identities)
    boundary_masks = (*combined, *complete_identity_boundaries(restored, detections, explicit))
    yield "v2_plus_contact_product_casing_and_boundaries", boundary_masks
    person_masks = (*boundary_masks, *detect_person_slots(text, restored, detections))
    yield "v2_plus_contact_product_casing_boundaries_and_person_slots", person_masks
    phone_slots = tuple(recover_number_slots(text))
    contact_masks = (*person_masks, *phone_slots)
    yield "v2_plus_contact_product_casing_boundaries_and_contact_slots", contact_masks
    yield "with_spoken_email_repairs", (*contact_masks, *email_slots)

    sites = tuple(public_website_ranges(text))
    guarded = tuple(hit for hit in detections if not preserving_public_ref(text, hit, explicit, sites))
    guarded_masks = (
        *fixed, *additional, *guarded, *complete_identity_boundaries(restored, guarded, explicit),
        *detect_person_slots(text, restored, guarded), *phone_slots, *email_slots,
    )
    yield "with_public_website_guard", guarded_masks
    employers = tuple(employer_slots(text))
    yield "with_explicit_employment_spans", (*guarded_masks, *employers)
    names = tuple(confirmed_name_slots(text))
    yield "with_confirmed_names", (*guarded_masks, *employers, *names)
    private_hits = (*explicit, *names, *employers)
    commercial = tuple(hit for hit in guarded if not is_explicit_commercial_reference(text, hit, private_hits))
    commercial_masks = (
        *fixed, *additional, *commercial, *complete_identity_boundaries(restored, commercial, explicit),
        *detect_person_slots(text, restored, commercial), *phone_slots, *email_slots, *names, *employers,
    )
    yield "with_commercial_reference_guard", commercial_masks
    address_masks = (*commercial_masks, *recover_address_slots(text))
    yield "with_spoken_address_repairs", address_masks
    mailbox_masks = (*address_masks, *recover_corroborated_mailboxes(text))
    yield "with_corroborated_mailboxes", mailbox_masks
    mailboxes = tuple(hit for hit in mailbox_masks if hit.label in {"email", "email address", "EMAIL_ADDRESS"})
    phone_masks = (*mailbox_masks, *recover_corroborated_numbers(text, mailboxes))
    yield "with_corroborated_phone_runs", phone_masks
    name_masks = (*phone_masks, *record_name_slots(text, commercial))
    yield "with_person_record_cues", name_masks
    complete = (*name_masks, *recover_corroborated_addresses(text))
    yield "with_corroborated_addresses", complete
    locators = tuple(explicit_spoken_locator_ranges(text, sites))
    yield CANDIDATE, tuple(hit for hit in complete if not inside_public_locator(hit, locators, private_hits))


def render_redacted(text, spans):
    """Replace the union of the same scored spans with readable placeholders."""
    parts, end = [], 0
    ordered = sorted((hit.start, hit.end) for hit in _validated_spans(text, spans))
    for start, stop in ordered:
        if end == 0 or start > end:
            parts.extend((text[end:start], "[redacted]"))
        end = max(end, stop)
    parts.append(text[end:])
    return "".join(parts)


def _validated_spans(text, spans):
    result = tuple(spans)
    if any(not 0 <= hit.start < hit.end <= len(text) for hit in result):
        raise ValueError("Recognizer returned an invalid source span")
    return result


def _candidate_spans(text, deterministic, predict, restore):
    for policy, spans in span_variants(text, deterministic, predict, restore):
        if policy == CANDIDATE:
            return _validated_spans(text, spans)
    raise RuntimeError("The configured candidate was absent from the pipeline")


def redaction_spans(text, deterministic, predict, restore):
    """Return source spans only after all required model calls succeed."""
    if restore is None:
        raise ValueError("The candidate requires the configured casing model")
    try:
        return _candidate_spans(text, deterministic, predict, restore)
    except RedactionInputTooLong:
        windows = tuple(answer_windows(text))
        if len(windows) < 2:
            raise

    spans = []
    for start, end in windows:
        section = text[start:end]
        for hit in _candidate_spans(section, deterministic, predict, restore):
            spans.append(Hit(hit.label, start + hit.start, start + hit.end))
    return tuple(spans)


def redact(text, deterministic, predict, restore):
    """Render the unqualified candidate for private synthetic verification."""
    return render_redacted(text, redaction_spans(text, deterministic, predict, restore))
