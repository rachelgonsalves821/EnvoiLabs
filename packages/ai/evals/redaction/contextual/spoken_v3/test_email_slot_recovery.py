import unittest

from email_slot_recovery import recover_corroborated_mailboxes, recover_email_slots


def spans(text):
    return [text[hit.start:hit.end] for hit in recover_email_slots(text)]


class EmailSlotRecoveryTests(unittest.TestCase):
    def test_misheard_dot_after_a_direct_email_label(self):
        address = "winter dot oak at mailbox daught test"
        self.assertEqual(spans(f"my email is {address} and the gate was locked"), [address])

    def test_split_and_dictated_suffixes_keep_original_text(self):
        for suffix in ("te st", "t e s t"):
            address = f"cloud two at mailbox dot {suffix}"
            with self.subTest(suffix=suffix):
                self.assertEqual(spans(f"write to {address} and leave the survey open"), [address])

    def test_fused_host_needs_explicit_email_context(self):
        address = "beech at mailboxcom"
        self.assertEqual(spans(f"email me at {address} then open the help panel"), [address])
        self.assertEqual(spans("i looked at mailboxcom then opened the help panel"), [])

    def test_missing_separator_can_stay_inside_a_labeled_address(self):
        address = "shelf two mailbox dot test"
        self.assertEqual(spans(f"my email address is {address} and the food was cold"), [address])

    def test_misheard_at_still_requires_an_address_shape(self):
        address = "one underscore place and mailbox dot test"
        self.assertEqual(spans(f"my inbox is {address} before noon"), [address])

    def test_public_website_visit_and_product_label_remain_available(self):
        self.assertEqual(spans("try the new dishes at market dot com"), [])
        self.assertEqual(spans("i used the menu at market dot com and the type was small"), [])


class CorroboratedMailboxTests(unittest.TestCase):
    def recovered(self, text):
        return {text[hit.start:hit.end] for hit in recover_corroborated_mailboxes(text)}

    def test_explicit_mailbox_supports_split_host_and_two_word_marker(self):
        address = "ember five as an violet creek dot test"
        self.assertIn(address, self.recovered(f"my inbox is {address} before the deadline"))

    def test_phone_and_follow_up_wording_support_corrupted_separator(self):
        address = "windmill pears at violet creek drug test"
        text = f"you can call one six zero four five five five zero one zero zero try {address} before noon"
        self.assertIn(address, self.recovered(text))
        self.assertEqual(self.recovered(f"try {address} before noon"), set())

    def test_fused_separator_and_suffix(self):
        address = "winter brick at mailbox dotcom"
        self.assertIn(address, self.recovered(f"my inbox is {address} before noon"))

    def test_verified_mailbox_keeps_unpunctuated_feedback_after_fused_host(self):
        address = "winter brick at meadowtest"
        text = f"the email we verified is {address} the chair near the counter was handy"
        self.assertEqual(self.recovered(text), {address})

    def test_split_suffix_stops_before_feedback(self):
        address = "ember flight at violet creek dott te st"
        text = f"in my email field please enter {address} the menu price was easy to find"
        self.assertIn(address, self.recovered(text))

    def test_explicit_website_language_preserves_research(self):
        self.assertEqual(self.recovered("my inbox is open and i used the public site at market dot com"), set())
        text = "call one six zero four five five five zero one zero zero try our product label at market dot com"
        self.assertEqual(self.recovered(text), set())


class LabeledSpellingTests(unittest.TestCase):
    def recovered(self, text):
        return {text[hit.start:hit.end] for detector in (recover_email_slots, recover_corroborated_mailboxes)
                for hit in detector(text)}

    def test_explicit_address_role_can_identify_two_space_split_words_on_each_side(self):
        examples = (
            ("My email address is", "fern folio at small grove dot solutions", ". The app showed checkout."),
            ("Email me at", "sage depot at granite coast dot technology", " for the confirmation."),
            ("The email address I verified is", "alder archive at meadow bridge dot services", ". The tab stayed open."),
            ("Reply by email to", "birch notes at sign elm hill dot systems", " for the survey reply."),
        )
        for cue, address, following in examples:
            with self.subTest(cue=cue):
                self.assertEqual(self.recovered(f"{cue} {address}{following}"), {address})

    def test_space_split_handle_needs_an_explicit_address_role_and_clear_boundary(self):
        texts = (
            "Fern folio at small grove dot solutions for the reply.",
            "View fern folio at small grove dot solutions for the reply.",
            "The official catalog lists fern folio at small grove dot solutions.",
            "My inbox is full today at small grove dot solutions, which shows the backlog.",
            "My email address is for urgent orders at small grove dot solutions.",
            "Email me at fern folio at public site dot solutions.",
            "Email me at fern folio at small grove dot solutions show only the new pricing",
            "Email me at fern folio at small grove dot solutions as the public site.",
        )
        for text in texts:
            with self.subTest(text=text):
                self.assertEqual(self.recovered(text), set())

    def test_private_address_spelling_keeps_the_complete_source_span(self):
        addresses = (
            "maple dot folio at relay dot example",
            "maple.folio at relay.example",
            "maple.folioatrelay.example",
            "maple dot folioatrelay dot example",
            "maple folio at relay dot example",
            "maple underscore folio at relay dot example",
            "maple dot folio plus check at relay dot example",
            "maple dot folio relay dot example",
            "maple folio relay dot example",
            "maple folio at sign mail dot relay dot example",
        )
        for address in addresses:
            with self.subTest(address=address):
                text = f"Earlier I compared prices. My private email address is {address} the cart estimate was forty minutes"
                self.assertEqual(self.recovered(text), {address})

    def test_spelled_address_preserves_case_and_unicode_character_offsets(self):
        address = "Érable.FolioatRelay.example"
        text = f"😊 Straßen are narrow. My email: {address}, then I kept the order open."
        self.assertEqual(self.recovered(text), {address})

    def test_spoken_tld_can_complete_a_valid_shorter_suffix(self):
        address = "cedar folio at relay dot co m"
        text = f"For email use {address} then check the product label."
        self.assertIn(address, self.recovered(text))

    def test_long_domain_endings_accept_mixed_separators_with_a_clear_boundary(self):
        addresses = (
            "cedar.manuscript at relay dot mail.technology",
            "cedar dot manuscriptatrelay.mail dot solutions",
            "cedar manuscript at relay.mail dot technology",
            "cedar dot manuscript relay dot mail.solutions",
            "cedar manuscript at relay dot test.solutions",
            "cedar manuscript at relay.test dot solutions",
        )
        for address in addresses:
            with self.subTest(address=address):
                self.assertEqual(self.recovered(f"My inbox is {address}. Shipping took forty minutes."), {address})

    def test_unknown_ending_does_not_consume_public_labels_or_unbounded_prose(self):
        texts = (
            "the public website uses cedar manuscript at relay dot technology.",
            "my inbox is cedar manuscript at relay dot technology improved checkout today",
            "my email: cedar manuscript at relay dot the. Checkout was fast.",
            "my inbox is cedar.manuscript at relay dot mail.solutions as the public website.",
            "my inbox is cedar.manuscript at relay dot test.solutions as the public website.",
        )
        for text in texts:
            with self.subTest(text=text):
                self.assertEqual(self.recovered(text), set())

    def test_public_website_and_feedback_stay_untouched(self):
        texts = (
            "my email is about the catalog at relay dot com",
            "my inbox is open and i used the public site at market dot com",
            "my inbox is open and i used the public site at marketcom",
            "my email is open while i browse maple.folioatrelay.example",
            "the public website uses maple dot folio at relay dot example",
            "i used maple folio at relay dot example as the public website",
            "my email address is the public page maple.folioatrelay.example",
            "my email: relay dot example",
            "my email: maple.folio.relay.example",
            "my email address is undecided but we used maple dot folio at relay dot example",
        )
        for text in texts:
            with self.subTest(text=text):
                self.assertEqual(self.recovered(text), set())
